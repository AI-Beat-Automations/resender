import { type NextRequest } from "next/server"

import {
  captureUsageThreshold,
  messageEventProperties,
} from "@/lib/analytics/usage"
import { incrementUsage } from "@/lib/billing/usage-counter"
import {
  CUSTOMER_SERVICE_WINDOW_HOURS,
  isWindowOpen,
} from "@/lib/messages/customer-service-window"
import {
  getOutboundMessageByIdempotencyKey,
  insertOutboundMessage,
  type MessageRecord,
} from "@/lib/messages/message-log"
import {
  withApiRequestLog,
  type ApiLogCapture,
} from "@/lib/logs/api-request-log"
import { describeError, log } from "@/lib/observability/logger"
import {
  outboundLogger,
  resolveRequestId,
} from "@/lib/observability/outbound-log"
import { resolveSendTarget } from "@/lib/outbound/resolve-send-target"
import {
  parseOutboundSendInput,
  parseSendTarget,
} from "@/lib/outbound/send-request"
import { reconcileWhatsappContact } from "@/lib/outbound/whatsapp-recipient"
import {
  idempotentReplayResponse,
  runWhatsappSendGates,
} from "@/lib/outbound/whatsapp-send-gates"
import {
  exceedsWhatsappTextLimit,
  extractWhatsappContactWaId,
  extractWhatsappMessageId,
  isWhatsappExpiredTokenError,
  sendWhatsappOutboundMessage,
  WHATSAPP_TEXT_MAX_CHARS,
  type WhatsappOutboundContent,
} from "@/lib/outbound/whatsapp-send"
import { markPageTokenInvalid } from "@/lib/pages/page-registry"
import { captureDeferred } from "@/lib/posthog"

// Envía un mensaje por WhatsApp: texto o un adjunto por URL, nunca ambos.
// Body: { conversationId } | { pageId, recipientId, conversationId? }, más
// { reply } | { attachment } (ADR 0019).
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
// **Las plantillas van por otra ruta** (ADR 0024). El 409 lo dice sin rodeos:
// `requiresTemplate: true` explica qué hace falta y `templateSendingSupported:
// true` con el `message` le señalan al cliente `POST
// /api/meta/whatsapp/templates/send`. Esta ruta no manda plantillas: el body
// es el neutral de los tres canales, y reintentar acá no va a funcionar hasta
// que el contacto escriba.
export const runtime = "nodejs"

// La sección Logs guarda esta request (`bot → Resender`) desde el envoltorio:
// ve la respuesta que sale por cualquiera de los returns de abajo.
export const POST = withApiRequestLog(
  {
    channel: "whatsapp",
    eventType: "send",
    endpoint: "/api/meta/whatsapp/send",
  },
  handle
)

async function handle(request: NextRequest, capture: ApiLogCapture) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "outbound_send",
    channel: "whatsapp",
    subject: "message",
    requestId,
    capture,
  })

  // API key, Idempotency-Key, permiso de canal, waitlist, cuota y replay
  // idempotente: los comparte con las demás rutas de envío de WhatsApp.
  const gates = await runWhatsappSendGates(request, trace)
  if (!gates.ok) return gates.response
  const { apiKey, periodStart, quota, idempotencyKey } = gates

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

  // El parser común valida en dos niveles y acá se llaman por separado: primero
  // el destino (`conversationId`, o `pageId` + `recipientId`) y recién en el
  // paso 9 el contenido (el XOR texto/adjunto, el tipo y la URL https). Es lo
  // que permite **diferir** los errores de contenido hasta después de los gates
  // 6 y 7.
  //
  // Diferirlos no es cosmético: un adjunto con URL `http:` mandado a una ventana
  // cerrada tiene que contestar 409 y no 400. La causa de más arriba es la que
  // el cliente necesita ver, porque arreglar la URL no le va a servir de nada
  // hasta que el contacto escriba.
  const target = parseSendTarget(body)
  if (!target.ok) {
    return trace.drop(
      "invalid_request",
      Response.json(
        { ...(target.code ? { code: target.code } : {}), error: target.error },
        { status: 400 }
      ),
      { ...(target.code ? { errorCode: target.code } : {}) }
    )
  }

  // ---- 6 y 7. La cuenta conectada y la conversación ----------------------
  // Dos formas de destino (ADR 0019): `conversationId` solo, o `pageId` +
  // `recipientId`. El resolvedor devuelve la cuenta, su token y la conversación
  // en las dos, y ya trae armados el status, el `code` y la razón del log.
  const resolved = await resolveSendTarget({
    tenantId: apiKey.tenantId,
    channel: "whatsapp",
    target: target.value,
  })
  if (!resolved.ok) {
    return trace.drop(
      resolved.reason,
      Response.json(
        {
          ...(resolved.code ? { code: resolved.code } : {}),
          error: resolved.error,
        },
        { status: resolved.status }
      ),
      {
        ...(resolved.code ? { errorCode: resolved.code } : {}),
        ...(resolved.errorMessage
          ? { errorMessage: resolved.errorMessage }
          : {}),
      }
    )
  }
  const { page, pageAccessToken } = resolved.value
  let conversation = resolved.value.conversation
  trace.setAccount(page)

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
          // Qué hace falta y dónde se hace, en el mismo objeto. Sin el
          // `message` un cliente leería `requiresTemplate` como "mandá una
          // plantilla por esta misma ruta" y se quedaría reintentando acá.
          requiresTemplate: true,
          templateSendingSupported: true,
          message: `This contact hasn't messaged the number in the last ${CUSTOMER_SERVICE_WINDOW_HOURS} hours, so WhatsApp only accepts approved template messages. Send one with POST /api/meta/whatsapp/templates/send, or wait for the contact to write again.`,
        },
        { status: 409 }
      )
    )
  }

  // ---- 9. El contenido ----------------------------------------------------
  // Recién acá se mira el contenido que se difirió arriba, y acá se valida el
  // largo del texto. Antes de llamar a Meta, no después: el rechazo de Cloud
  // API por pasarse no dice cuánto sobró.
  const input = parseOutboundSendInput(body)
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
    accessToken: pageAccessToken,
    // En WhatsApp `meta_page_id` guarda el `phone_number_id`, que es el id del
    // path de Cloud API: el `pageId` público y el del envío son el mismo valor.
    phoneNumberId: page.metaPageId,
    to: conversation.contactId,
    content,
  })
  const metaDurationMs = Date.now() - sentAt.getTime()

  if (!metaResult.ok && isWhatsappExpiredTokenError(metaResult.data)) {
    try {
      await markPageTokenInvalid({
        tenantId: apiKey.tenantId,
        connectionId: page.id,
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
        connectionId: page.id,
        channel: "whatsapp",
        accountId: page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  // El wamid que devolvió Meta. Es lo que después va a traer el callback de
  // `statuses` para decir si el mensaje se entregó o lo leyeron: sin guardarlo
  // acá, ese callback no encuentra la fila que tiene que actualizar.
  const wamid = extractWhatsappMessageId(metaResult.data)

  // El `wa_id` con el que van a llegar las respuestas puede no ser el número
  // marcado (ADR 0024): el mensaje se guarda en la conversación de ese `wa_id`,
  // y esa es la que vuelve en `resender.conversationId`. Best-effort: Meta ya
  // aceptó el mensaje, así que un fallo acá lo deja donde estaba en vez de
  // perder la fila.
  if (metaResult.ok) {
    try {
      const reconciled = await reconcileWhatsappContact({
        tenantId: apiKey.tenantId,
        conversation,
        waId: extractWhatsappContactWaId(metaResult.data),
      })
      if (reconciled.kind !== "unchanged") {
        conversation = reconciled.conversation
        log({
          entrypoint: "route",
          action: "whatsapp_contact_reconcile",
          outcome: "ok",
          requestId,
          tenantId: apiKey.tenantId,
          connectionId: page.id,
          channel: "whatsapp",
          accountId: page.metaPageId,
          contactId: conversation.contactId,
        })
      }
    } catch (error) {
      log({
        entrypoint: "route",
        action: "whatsapp_contact_reconcile",
        outcome: "failed",
        reason: "internal_error",
        requestId,
        tenantId: apiKey.tenantId,
        connectionId: page.id,
        channel: "whatsapp",
        accountId: page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  let message: MessageRecord
  try {
    // Se persiste tanto si Meta lo aceptó como si lo rechazó: el fallo también
    // es historial, y es justo lo que el usuario necesita poder ver en el log
    // cuando pregunta por qué su cliente no recibió nada.
    message = await insertOutboundMessage({
      tenantId: apiKey.tenantId,
      conversationId: conversation.id,
      connectedPageId: page.id,
      contactId: conversation.contactId,
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
    contactId: conversation.contactId,
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
      const usage = await incrementUsage(apiKey.tenantId, periodStart)
      captureUsageThreshold(apiKey.tenantId, usage, quota)
    } catch (error) {
      log({
        entrypoint: "route",
        action: "usage_increment",
        outcome: "failed",
        reason: "usage_counter_failed",
        requestId,
        tenantId: apiKey.tenantId,
        channel: "whatsapp",
        accountId: page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  captureDeferred({
    distinctId: apiKey.tenantId,
    event: "message sent",
    properties: {
      message_id: message.id,
      conversation_id: conversation.id,
      page_id: page.metaPageId,
      ...messageEventProperties(page, quota),
      channel: "whatsapp",
      status: message.status,
      meta_ok: metaResult.ok,
    },
  })

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

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}
