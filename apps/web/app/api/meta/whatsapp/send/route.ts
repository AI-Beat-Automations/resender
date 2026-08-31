import { type NextRequest } from "next/server"

import { authenticateApiKey } from "@/lib/auth/api-keys"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { hasActiveSubscription } from "@/lib/billing/subscription"
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
import {
  getBearerToken,
  parseOutboundSendInput,
} from "@/lib/outbound/send-request"
import {
  exceedsWhatsappTextLimit,
  extractWhatsappMessageId,
  isWhatsappExpiredTokenError,
  sendWhatsappOutboundMessage,
  WHATSAPP_TEXT_MAX_CHARS,
  type WhatsappOutboundContent,
} from "@/lib/outbound/whatsapp-send"
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
// **Las plantillas están fuera de alcance.** El 409 lo dice sin rodeos:
// `requiresTemplate: true` explica qué haría falta, `templateSendingSupported:
// false` admite que Resender todavía no lo hace. Es una señal honesta, no un
// placeholder: un cliente que la lee sabe que tiene que esperar a que el
// contacto escriba, y no que reintentando va a funcionar.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "outbound_send",
    channel: "whatsapp",
    subject: "message",
    requestId,
  })

  // ---- 1. API key ---------------------------------------------------------
  const bearer = getBearerToken(request.headers.get("authorization"))
  const apiKey = await authenticateApiKey(bearer)
  if (!apiKey) {
    return trace.drop(
      "unauthorized",
      Response.json({ error: "unauthorized" }, { status: 401 })
    )
  }
  trace.setTenant(apiKey.tenantId)

  // ---- 2. Idempotency-Key -------------------------------------------------
  // **Obligatoria en este canal**, a diferencia de Messenger e Instagram donde
  // es opcional. En WhatsApp el mensaje le llega a un teléfono y un duplicado se
  // ve como una molestia real del negocio hacia su cliente, no como una línea
  // repetida en un chat de escritorio. Exigirla es lo que hace que el reintento
  // —que en una API HTTP siempre va a pasar— sea seguro por defecto en vez de
  // por buena voluntad del que integra.
  const idempotencyHeader = request.headers.get("idempotency-key")
  const idempotencyKey = idempotencyHeader?.trim() ?? null
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return trace.drop(
      "invalid_request",
      Response.json(
        {
          error:
            "Idempotency-Key is required and must be a non-empty string of at most 200 characters",
        },
        { status: 400 }
      )
    )
  }

  // ---- 3. Permiso de canal (ADR 0010) -------------------------------------
  // Va **antes** del replay idempotente: un envío guardado de cuando el canal
  // estaba habilitado no puede seguir contestando 200 después de que se revocó
  // el permiso.
  //
  // El `error` es genérico a propósito y no `whatsapp_not_enabled`: se escribió
  // así anticipando este canal justamente para que un cliente que ya distingue
  // el caso en Messenger o Instagram no tenga que aprender un código nuevo. Es
  // el `message` el que nombra a WhatsApp, porque la misma API key sirve para
  // los otros canales, que sí pueden estar abiertos.
  if (!(await resolveWhatsappAccess(apiKey.tenantId))) {
    return trace.drop(
      "channel_not_enabled",
      Response.json(
        {
          error: "channel_not_enabled",
          message: "whatsapp channel is not enabled",
        },
        { status: 403 }
      )
    )
  }

  // ---- 4. Suscripción, waitlist y cuota -----------------------------------
  if (await isUserWaitlisted(apiKey.tenantId)) {
    return trace.drop(
      "waitlisted",
      Response.json({ error: "account is on the waitlist" }, { status: 403 })
    )
  }

  if (!(await hasActiveSubscription(apiKey.tenantId))) {
    return trace.drop(
      "no_active_subscription",
      Response.json({ error: "no active subscription" }, { status: 403 })
    )
  }

  // ADR 0003: con la cuota del período agotada o con más conexiones de las que
  // permite el plan, la cuenta queda restringida y no envía por ninguna de sus
  // conexiones, de cualquier canal.
  const { block, periodStart } = await getTenantEntitlement(apiKey.tenantId)
  // Un período sin resolver siempre viene acompañado de `block` (el módulo puro
  // es fail-closed); comprobar ambos es lo que estrecha el tipo de `periodStart`
  // hasta el incremento del contador, sin recurrir a `!`.
  if (block || !periodStart) {
    return trace.drop(
      "plan_restricted",
      Response.json(
        {
          error: block?.code ?? "plan_unavailable",
          message:
            block?.message ??
            "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
        },
        { status: block?.status ?? 403 }
      ),
      { errorCode: block?.code ?? "plan_unavailable" }
    )
  }

  // ---- 5. Replay idempotente ----------------------------------------------
  // No llama a Meta ni inserta, así que devolver el resultado ya almacenado es
  // lo único correcto: bloquearlo con un 402 le diría al cliente que falló un
  // mensaje que Meta ya entregó, justo en el reintento que la Idempotency-Key
  // existe para hacer seguro.
  const replay = await getOutboundMessageByIdempotencyKey(
    apiKey.tenantId,
    idempotencyKey
  )
  if (replay) {
    return trace.duplicate(idempotentReplayResponse(replay), {
      subjectId: replay.id,
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "invalid json" }, { status: 400 })
    )
  }

  if (!body || typeof body !== "object") {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "invalid body" }, { status: 400 })
    )
  }

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
          // Qué haría falta y qué no hacemos, en el mismo objeto. Sin
          // `templateSendingSupported` un cliente leería `requiresTemplate` como
          // "mandá una plantilla por esta misma ruta" y se quedaría reintentando
          // contra algo que no existe.
          requiresTemplate: true,
          templateSendingSupported: false,
          message: `This contact hasn't messaged the number in the last ${CUSTOMER_SERVICE_WINDOW_HOURS} hours, so WhatsApp only accepts approved template messages. Resender doesn't send templates yet: wait for the contact to write again.`,
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

function idempotentReplayResponse(message: MessageRecord) {
  return Response.json({
    ...(message.status === "failed" && message.error
      ? { error: message.error }
      : {}),
    meta: message.providerResponse,
    resender: {
      conversationId: message.conversationId,
      messageId: message.id,
      status: message.status,
      idempotentReplay: true,
    },
  })
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}
