import { type NextRequest } from "next/server"

import { incrementUsage } from "@/lib/billing/usage-counter"
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
import { parseTemplateSendInput } from "@/lib/outbound/template-send-request"
import { reconcileWhatsappContact } from "@/lib/outbound/whatsapp-recipient"
import {
  idempotentReplayResponse,
  runWhatsappSendGates,
} from "@/lib/outbound/whatsapp-send-gates"
import {
  extractWhatsappContactWaId,
  extractWhatsappMessageId,
  isWhatsappExpiredTokenError,
  sendWhatsappOutboundMessage,
} from "@/lib/outbound/whatsapp-send"
import { markPageTokenInvalid } from "@/lib/pages/page-registry"
import { captureDeferred } from "@/lib/posthog"

// Envía una [Plantilla] aprobada por WhatsApp (ADR 0024). Body:
// { conversationId } | { pageId, recipientId, conversationId? }, más
// { template: { name, language, components? } }.
//
// **Es la ruta para escribirle a quien tiene la ventana de 24 h cerrada** o
// nunca escribió: `/whatsapp/send` contesta 409 en ese caso y apunta acá. Por
// eso esta ruta **no** mira la ventana; es justo lo que la plantilla existe
// para saltar.
//
// Ruta separada y no un tercer tipo de contenido en `/send`:
// `parseOutboundSendInput` es neutral de canal y lo comparten los tres, y una
// plantilla solo existe en WhatsApp. El destino, los gates, la conciliación
// del `wa_id`, la persistencia y la forma de la respuesta son los de `/send`,
// para que un cliente que ya integra uno integre el otro cambiando la URL y el
// contenido.
//
// El Plan Free puede enviar plantillas: no hay control de plan extra. Consume 1
// de cuota solo si Meta aceptó, como cualquier envío.
//
// **Todavía no se controla que la plantilla esté aprobada**: la copia local de
// las plantillas no existe aún. Si no lo está, el rechazo llega de Meta.
export const runtime = "nodejs"

export const POST = withApiRequestLog(
  {
    channel: "whatsapp",
    eventType: "template_send",
    endpoint: "/api/meta/whatsapp/templates/send",
  },
  handle
)

async function handle(request: NextRequest, capture: ApiLogCapture) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "template_send",
    channel: "whatsapp",
    subject: "message",
    requestId,
    capture,
  })

  // API key, Idempotency-Key, permiso de canal, waitlist, cuota y replay
  // idempotente: los mismos de `/whatsapp/send`.
  const gates = await runWhatsappSendGates(request, trace)
  if (!gates.ok) return gates.response
  const { apiKey, periodStart, idempotencyKey } = gates

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "invalid json" }, { status: 400 })
    )
  }

  // Destino y plantilla de una vez: sin ventana que mirar, no hay un error de
  // más arriba que tenga que ganarle al de contenido, como en `/send`.
  const input = parseTemplateSendInput(body)
  if (!input.ok) {
    return trace.drop(
      "invalid_request",
      Response.json(
        { ...(input.code ? { code: input.code } : {}), error: input.error },
        { status: 400 }
      ),
      { ...(input.code ? { errorCode: input.code } : {}) }
    )
  }
  const { template } = input.value

  const resolved = await resolveSendTarget({
    tenantId: apiKey.tenantId,
    channel: "whatsapp",
    target: input.value.target,
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

  const sentAt = new Date()
  const metaResult = await sendWhatsappOutboundMessage({
    accessToken: pageAccessToken,
    phoneNumberId: page.metaPageId,
    to: conversation.contactId,
    content: { template },
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

  const wamid = extractWhatsappMessageId(metaResult.data)

  // Igual que en `/send` (ADR 0024): las respuestas pueden llegar con un
  // `wa_id` distinto del número marcado, y es lo más común acá, porque una
  // plantilla suele ir a quien nunca escribió. Best-effort: Meta ya aceptó.
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
    // Una plantilla no es un [Adjunto]: `text = ''`, sin `attachment_*`, y lo
    // que salió va en `template_meta`, con los parámetros **de este envío**.
    message = await insertOutboundMessage({
      tenantId: apiKey.tenantId,
      conversationId: conversation.id,
      connectedPageId: page.id,
      contactId: conversation.contactId,
      text: "",
      status: metaResult.ok ? "sent" : "failed",
      metaMessageId: wamid,
      idempotencyKey,
      attachment: null,
      origin: "resender_api",
      templateMeta: template,
      error: metaResult.reason ?? metaResult.error,
      providerResponse: metaResult.data,
      createdAt: sentAt,
    })
  } catch (error) {
    // Carrera de dos requests con la misma Idempotency-Key.
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

  // El nombre de la plantilla sí se loguea; los `components` no, porque traen
  // datos del cliente final.
  const traceFields = {
    subjectId: message.id,
    providerId: wamid ?? undefined,
    contactId: conversation.contactId,
    templateName: template.name,
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

  // Solo consume cuota lo que Meta aceptó. Best-effort: un fallo del contador
  // no puede hacer fallar un mensaje que Meta ya entregó.
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
      channel: "whatsapp",
      status: message.status,
      meta_ok: metaResult.ok,
      template: true,
    },
  })

  // La misma forma que `/whatsapp/send`, de éxito o de fallo.
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
