import { type NextRequest } from "next/server"

import { incrementUsage } from "@/lib/billing/usage-counter"
import {
  CUSTOMER_SERVICE_WINDOW_HOURS,
  isWindowOpen,
} from "@/lib/messages/customer-service-window"
import {
  getConversationById,
  getOutboundMessageByIdempotencyKey,
  insertOutboundMessage,
  upsertConversation,
  type MessageRecord,
} from "@/lib/messages/message-log"
import { describeError, log } from "@/lib/observability/logger"
import {
  outboundLogger,
  resolveRequestId,
} from "@/lib/observability/outbound-log"
import { parseOutboundSendInput } from "@/lib/outbound/send-request"
import {
  exceedsWhatsappTextLimit,
  extractWhatsappMessageId,
  isWhatsappExpiredTokenError,
  sendWhatsappOutboundMessage,
  WHATSAPP_TEXT_MAX_CHARS,
  type WhatsappOutboundContent,
} from "@/lib/outbound/whatsapp-send"
import {
  idempotentReplayResponse,
  isUniqueViolation,
  runWhatsappSendGates,
} from "@/lib/outbound/whatsapp-send-gates"
import {
  getActivePageWithTokenForTenant,
  markPageTokenInvalid,
} from "@/lib/pages/page-registry"
import { posthog } from "@/lib/posthog"

// Envía un mensaje por WhatsApp: texto o un adjunto por URL, nunca ambos.
// Body: { pageId, recipientId, conversationId? } + { reply } | { attachment }.
//
// **El body es el mismo que el de Messenger a propósito.** `pageId` es "la
// cuenta conectada desde la que sale el mensaje" —acá el `phone_number_id` del
// número— y es la misma columna (`connected_pages.meta_page_id`) en los tres
// canales. Un cliente que atiende varios cambia la URL y nada más. El nombre se
// lee raro en WhatsApp; el costo de que fueran tres contratos distintos es peor.
//
// **La ventana de 24 h se resuelve acá, en local, antes de llamar a Meta.** Es
// la diferencia grande con Messenger e Instagram, donde el rechazo por ventana
// llega de Meta. En WhatsApp lo sabemos por `conversations.last_inbound_at` y
// cortar antes tiene tres ventajas: la respuesta es inmediata, dice exactamente
// qué pasó, y no gasta una llamada a Cloud API que ya sabemos que va a fallar.
//
// **Las plantillas ya existen, pero no por acá** (ADR 0014). El 409 dejó de ser
// un callejón: `requiresTemplate: true` explica qué haría falta y
// `templateSendingSupported: true` dice que Resender lo hace, y el `message`
// nombra la ruta —`POST /api/meta/whatsapp/templates/send`— para que el que
// integra descubra la capacidad desde el error mismo y no desde la doc.
// Reintentar por esta ruta no va a funcionar nunca, y el mensaje lo dice.
//
// Que la plantilla tenga ruta propia y no una rama de ésta es una decisión de
// la 0014: el body de acá lo parsea `parseOutboundSendInput`, que es neutral de
// canal y lo comparten los tres. Meterle una tercera rama a un XOR que
// Messenger e Instagram no pueden usar es costo permanente para los tres a
// cambio de ahorrar una ruta. Los ocho gates previos sí se comparten, en
// `lib/outbound/whatsapp-send-gates.ts`.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "outbound_send",
    channel: "whatsapp",
    subject: "message",
    requestId,
  })

  // Los ocho gates que toda ruta de envío de WhatsApp pasa antes de mirar qué
  // le pidieron: API key, Idempotency-Key, permiso de canal, waitlist,
  // suscripción, entitlement, replay idempotente y el JSON del body. Viven en
  // un módulo compartido porque la ruta de plantillas (ADR 0014) los necesita
  // idénticos y en el mismo orden; el rechazo ya viene armado y ya logueado.
  const gates = await runWhatsappSendGates({ request, trace })
  if (!gates.ok) return gates.response
  const { apiKey, idempotencyKey, periodStart, body } = gates

  // Un solo parser, el neutral de canal, que valida en dos niveles: primero el
  // destino (`pageId`, `recipientId`, `conversationId`) y después el contenido
  // (el XOR texto/adjunto, el tipo y la URL https). Los errores de contenido son
  // los únicos que traen `code`, y eso es lo que permite **diferirlos** hasta el
  // paso 9 sin duplicar el parser: si vino un `code`, el destino ya pasó su
  // validación y se puede leer del body para aplicarle los gates 6, 7 y 8.
  //
  // Diferirlos no es cosmético: un adjunto con URL `http:` mandado a una ventana
  // cerrada tiene que contestar 409 y no 400. La causa de más arriba es la que
  // el cliente necesita ver, porque arreglar la URL no le va a servir de nada
  // hasta que el contacto escriba.
  const input = parseOutboundSendInput(body)
  if (!input.ok && !input.code) {
    return trace.drop(
      "invalid_request",
      Response.json({ error: input.error }, { status: 400 })
    )
  }
  const target = input.ok ? input.value : readSendTarget(body)

  // ---- 6. La cuenta conectada ---------------------------------------------
  // El canal va explícito: `meta_page_id` es único por `(channel, meta_page_id)`
  // desde la 0013, así que buscar sin canal puede traer la fila de otro.
  const connectedPage = await getActivePageWithTokenForTenant(
    apiKey.tenantId,
    target.pageId,
    "whatsapp"
  )
  if (!connectedPage) {
    return trace.drop(
      "page_not_connected",
      Response.json(
        { error: "WhatsApp number is not connected for this tenant" },
        { status: 404 }
      ),
      { errorMessage: `phoneNumberId=${target.pageId}` }
    )
  }
  trace.setAccount(connectedPage.page)

  // ---- 7. La conversación -------------------------------------------------
  let conversation = target.conversationId
    ? await getConversationById(apiKey.tenantId, target.conversationId)
    : null

  if (target.conversationId) {
    if (
      !conversation ||
      conversation.connectedPageId !== connectedPage.page.id ||
      conversation.contactId !== target.recipientId
    ) {
      return trace.drop(
        "invalid_request",
        Response.json(
          { error: "conversationId does not match pageId and recipientId" },
          { status: 400 }
        )
      )
    }
  } else {
    // Sin `message`, así que este upsert **no** mueve `last_inbound_at`: un
    // saliente nuestro no abre la ventana. La fila que nace acá para un contacto
    // nuevo tiene `last_inbound_at` null y por lo tanto la ventana cerrada, que
    // es exactamente la semántica de WhatsApp: al primer contacto no se le
    // escribe sin plantilla. La conversación queda creada aunque el envío se
    // rechace en el gate siguiente, y está bien: es la misma fila que se va a
    // reusar cuando la persona escriba.
    conversation = await upsertConversation({
      tenantId: apiKey.tenantId,
      connectedPageId: connectedPage.page.id,
      contactId: target.recipientId,
      lastMessageAt: new Date(),
    })
  }

  if (!conversation) {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "conversation not found" }, { status: 400 })
    )
  }

  // ---- 8. La ventana de atención de 24 h ----------------------------------
  // **Sin llamar a Cloud API.** Con la ventana cerrada Meta rechazaría con un
  // 131047 y el mensaje quedaría igual sin entregar; la diferencia es que este
  // 409 sale en milisegundos, nombra la causa y no consume ni cuota ni
  // throughput del número.
  if (!isWindowOpen(conversation.lastInboundAt, new Date())) {
    return trace.drop(
      "customer_service_window_closed",
      Response.json(
        {
          error: "customer_service_window_closed",
          // Qué haría falta y dónde se hace, en el mismo objeto. Las dos
          // banderas siguen haciendo falta por separado: `requiresTemplate`
          // nombra la regla de WhatsApp y `templateSendingSupported` dice si
          // Resender la puede cumplir. Desde la ADR 0014 dice `true`, y el
          // `message` lleva hasta la ruta: el que integra descubre la capacidad
          // desde el error, que es donde está mirando cuando la necesita.
          //
          // Lo que **no** cambia es que reintentar por esta ruta no va a
          // funcionar nunca. El código sigue siendo el mismo a propósito: la
          // causa es la misma y un cliente que ya lo distingue no tiene que
          // aprender uno nuevo para enterarse de que ahora hay salida.
          requiresTemplate: true,
          templateSendingSupported: true,
          message: `This contact hasn't messaged the number in the last ${CUSTOMER_SERVICE_WINDOW_HOURS} hours, so WhatsApp only accepts approved template messages. Send one with POST /api/meta/whatsapp/templates/send.`,
        },
        { status: 409 }
      )
    )
  }

  // ---- 9. El contenido ----------------------------------------------------
  // Recién acá se contestan los errores de contenido que el parser difirió, y
  // acá se valida el largo del texto. Antes de llamar a Meta, no después: el
  // rechazo de Cloud API por pasarse no dice cuánto sobró.
  if (!input.ok) {
    return trace.drop(
      "invalid_request",
      Response.json({ code: input.code, error: input.error }, { status: 400 }),
      { errorCode: input.code ?? undefined }
    )
  }

  // En caracteres y no en bytes: Cloud API cuenta 4096 caracteres para el
  // `text.body`, a diferencia de Instagram que cuenta bytes UTF-8.
  if (
    input.value.reply !== null &&
    exceedsWhatsappTextLimit(input.value.reply)
  ) {
    return trace.drop(
      "reply_too_long",
      Response.json(
        {
          error: `reply is too long: WhatsApp allows ${WHATSAPP_TEXT_MAX_CHARS} characters and this message is ${input.value.reply.length}`,
        },
        { status: 400 }
      ),
      { textLength: input.value.reply.length }
    )
  }

  const content: WhatsappOutboundContent = input.value.attachment
    ? { reply: null, attachment: input.value.attachment }
    : { reply: input.value.reply as string, attachment: null }

  const sentAt = new Date()
  const metaResult = await sendWhatsappOutboundMessage({
    accessToken: connectedPage.pageAccessToken,
    // En WhatsApp `meta_page_id` guarda el `phone_number_id`, que es el id del
    // path de Cloud API: el `pageId` público y el del envío son el mismo valor.
    phoneNumberId: connectedPage.page.metaPageId,
    to: target.recipientId,
    content,
  })
  const metaDurationMs = Date.now() - sentAt.getTime()

  if (!metaResult.ok && isWhatsappExpiredTokenError(metaResult.data)) {
    try {
      await markPageTokenInvalid({
        tenantId: apiKey.tenantId,
        connectionId: connectedPage.page.id,
        error:
          metaResult.error ??
          "Meta rejected the WhatsApp token. Reconnect the number in Resender.",
      })
    } catch (error) {
      log({
        entrypoint: "route",
        action: "token_invalidate",
        outcome: "failed",
        reason: "internal_error",
        requestId,
        tenantId: apiKey.tenantId,
        connectionId: connectedPage.page.id,
        channel: "whatsapp",
        accountId: connectedPage.page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  // El wamid que devolvió Meta. Es lo que después va a traer el callback de
  // `statuses` para decir si el mensaje se entregó o lo leyeron: sin guardarlo
  // acá, ese callback no encuentra la fila que tiene que actualizar.
  const wamid = extractWhatsappMessageId(metaResult.data)

  let message: MessageRecord
  try {
    // Se persiste tanto si Meta lo aceptó como si lo rechazó: el fallo también
    // es historial, y es justo lo que el usuario necesita poder ver en el log
    // cuando pregunta por qué su cliente no recibió nada.
    message = await insertOutboundMessage({
      tenantId: apiKey.tenantId,
      conversationId: conversation.id,
      connectedPageId: connectedPage.page.id,
      contactId: target.recipientId,
      text: input.value.reply ?? "",
      status: metaResult.ok ? "sent" : "failed",
      metaMessageId: wamid,
      idempotencyKey,
      attachment: input.value.attachment,
      // Lo mandó la API pública, no el negocio desde la WhatsApp Business App.
      // Es la marca que evita que el webhook saliente reenvíe como novedad algo
      // que el propio tenant acaba de pedirnos enviar.
      origin: "resender_api",
      error: metaResult.reason ?? metaResult.error,
      providerResponse: metaResult.data,
      createdAt: sentAt,
    })
  } catch (error) {
    // Carrera de dos requests con la misma Idempotency-Key: el índice único
    // rechaza el segundo insert y devolvemos el mensaje ya almacenado.
    if (isUniqueViolation(error)) {
      const existing = await getOutboundMessageByIdempotencyKey(
        apiKey.tenantId,
        idempotencyKey
      )
      if (existing) {
        return trace.duplicate(idempotentReplayResponse(existing), {
          subjectId: existing.id,
        })
      }
    }
    trace.failed("internal_error", { errorMessage: describeError(error) })
    throw error
  }

  // Una línea terminal por request, con el código de Meta ya traducido al
  // catálogo de WhatsApp —que no es el de Messenger: un 131047 acá es la ventana
  // y no un permiso faltante—.
  const traceFields = {
    subjectId: message.id,
    providerId: wamid ?? undefined,
    contactId: target.recipientId,
    textLength: input.value.reply?.length ?? 0,
    status: metaResult.status,
    durationMs: metaDurationMs,
  }
  if (metaResult.ok) {
    trace.ok(traceFields)
  } else {
    trace.failed("meta_rejected", {
      ...traceFields,
      errorMessage: metaResult.reason ?? metaResult.error ?? undefined,
    })
  }

  // Solo consume cuota la respuesta que Meta aceptó. Los replays idempotentes y
  // el 409 de ventana cerrada ya devolvieron antes de llegar acá, así que no
  // suman. Best-effort: un fallo del contador no puede hacer fallar un mensaje
  // que Meta ya entregó.
  if (metaResult.ok) {
    try {
      await incrementUsage(apiKey.tenantId, periodStart)
    } catch (error) {
      log({
        entrypoint: "route",
        action: "usage_increment",
        outcome: "failed",
        reason: "usage_counter_failed",
        requestId,
        tenantId: apiKey.tenantId,
        channel: "whatsapp",
        accountId: connectedPage.page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  if (posthog) {
    posthog.capture({
      distinctId: apiKey.tenantId,
      event: "message sent",
      properties: {
        message_id: message.id,
        conversation_id: conversation.id,
        page_id: target.pageId,
        channel: "whatsapp",
        status: message.status,
        meta_ok: metaResult.ok,
      },
    })
    await posthog.flush()
  }

  return Response.json(
    {
      ...(metaResult.ok
        ? {}
        : {
            ...(metaResult.code ? { code: metaResult.code } : {}),
            error: metaResult.reason ?? metaResult.error,
          }),
      meta: metaResult.data,
      resender: {
        conversationId: conversation.id,
        messageId: message.id,
        status: message.status,
      },
    },
    { status: metaResult.status }
  )
}

// Sólo es alcanzable cuando el parser falló con un `code`, y para eso ya tuvo
// que haber validado los tres campos de destino: es una lectura, no una segunda
// validación. Si el parser cambiara de orden y empezara a devolver códigos
// antes de mirar el destino, los gates 6 y 7 se encargarían igual —una cuenta
// inexistente da 404 y una conversación que no coincide da 400—.
function readSendTarget(body: object) {
  const { pageId, recipientId, conversationId } = body as Record<
    string,
    unknown
  >
  return {
    pageId: typeof pageId === "string" ? pageId.trim() : "",
    recipientId: typeof recipientId === "string" ? recipientId.trim() : "",
    conversationId:
      typeof conversationId === "string" ? conversationId.trim() : undefined,
  }
}
