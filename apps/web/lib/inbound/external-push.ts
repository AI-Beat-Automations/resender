import { getSql } from "@/lib/db"
import type { InstagramCommentRecord } from "@/lib/comments/comment-log"
import type {
  ConversationRecord,
  MessageRecord,
} from "@/lib/messages/message-log"
import type {
  ConnectedPageRecord,
  PageChannel,
} from "@/lib/pages/page-registry"
import { normalizeWebhookUrl } from "@/lib/pages/webhook-url"
import { log, type LogReason } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"
import type { InboundEventType } from "./inbound-event"

// Sujeto de la entrega. `external_webhook_deliveries` acepta desde la migración
// 0013 un mensaje **o** un comentario, con un check de que sea exactamente uno;
// este tipo es esa restricción expresada en TypeScript, para que no se pueda
// construir una entrega sin sujeto ni con los dos.
export type DeliverySubject =
  | { kind: "message"; id: string }
  | { kind: "comment"; id: string }

export type InboundPushPayload = {
  // Discrimina el tipo de evento sin que el consumidor tenga que adivinar por
  // qué claves trae el objeto. Un tenant recibe mensajes y comentarios en el
  // mismo endpoint, y `switch (payload.type)` es todo lo que necesita.
  type: "message"
  tenant: { id: string }
  // `channel` y `username` son campos nuevos y siempre presentes, también en
  // Messenger (`username` va null ahí). Un tenant con los dos canales apuntando
  // al mismo webhook necesita distinguir de cuál vino el mensaje, y una forma
  // uniforme es más fácil de consumir que una que cambia según el canal.
  // Agregar campos es compatible: los consumidores existentes los ignoran.
  page: {
    id: string
    channel: PageChannel
    metaPageId: string
    name: string
    username: string | null
  }
  conversation: { id: string; contactId: string }
  message: {
    id: string
    metaMessageId: string | null
    eventType: InboundEventType
    postbackPayload: string | null
    direction: "inbound"
    status: "received"
    text: string
    createdAt: string
  }
}

export function buildInboundPushPayload(input: {
  page: ConnectedPageRecord
  conversation: ConversationRecord
  message: MessageRecord
  eventType: InboundEventType
  postbackPayload: string | null
}): InboundPushPayload {
  return {
    type: "message",
    tenant: { id: input.message.tenantId },
    page: {
      id: input.page.id,
      channel: input.page.channel,
      metaPageId: input.page.metaPageId,
      name: input.page.name,
      username: input.page.username,
    },
    conversation: {
      id: input.conversation.id,
      contactId: input.conversation.contactId,
    },
    message: {
      id: input.message.id,
      metaMessageId: input.message.metaMessageId,
      eventType: input.eventType,
      postbackPayload: input.postbackPayload,
      direction: "inbound",
      status: "received",
      text: input.message.text,
      createdAt: input.message.createdAt.toISOString(),
    },
  }
}

export type InboundCommentPushPayload = {
  type: "comment"
  tenant: { id: string }
  page: {
    id: string
    channel: PageChannel
    metaPageId: string
    name: string
    username: string | null
  }
  comment: {
    id: string
    igCommentId: string | null
    // Informado si el comentario responde a otro. Es lo que le permite al
    // consumidor reconstruir el hilo sin volver a consultar a Meta.
    parentIgCommentId: string | null
    mediaId: string
    mediaProductType: string | null
    from: { igId: string; username: string | null }
    direction: "inbound"
    status: "received"
    text: string
    createdAt: string
  }
}

export function buildInboundCommentPayload(input: {
  page: ConnectedPageRecord
  comment: InstagramCommentRecord
}): InboundCommentPushPayload {
  return {
    type: "comment",
    tenant: { id: input.comment.tenantId },
    page: {
      id: input.page.id,
      channel: input.page.channel,
      metaPageId: input.page.metaPageId,
      name: input.page.name,
      username: input.page.username,
    },
    comment: {
      id: input.comment.id,
      igCommentId: input.comment.igCommentId,
      parentIgCommentId: input.comment.parentIgCommentId,
      mediaId: input.comment.mediaId,
      mediaProductType: input.comment.mediaProductType,
      from: {
        igId: input.comment.fromIgId,
        username: input.comment.fromUsername,
      },
      direction: "inbound",
      status: "received",
      text: input.comment.text,
      createdAt: input.comment.createdAt.toISOString(),
    },
  }
}

export type PushPayload = InboundPushPayload | InboundCommentPushPayload

// Contexto de log de una entrega. Viaja desde la ingesta adentro del closure
// del `pushJob`, porque cuando este código corre —en el `after()` de Next— la
// request ya terminó y no hay de dónde volver a resolver la cuenta.
//
// **No incluye el `webhookUrl` a propósito.** Es una URL que controla el
// cliente y puede llevar un token en el path; las de n8n rutinariamente lo
// hacen. `connectionId` alcanza para saber cuál era.
export type DeliveryLogContext = {
  requestId?: string
  tenantId?: string
  connectionId?: string
  channel?: PageChannel
  accountId?: string
  accountHandle?: string
  subject?: "message" | "comment"
  subjectId?: string
  providerId?: string
  contactId?: string
}

// El motivo es parametrizable porque hay más de una razón para no entregar: la
// página sin `webhookUrl` y la cuenta restringida (ADR 0003), que persiste el
// entrante pero deja de reenviarlo.
export async function recordSkippedDelivery(
  subject: DeliverySubject,
  options: {
    // El texto que va a la columna `error` de la bitácora, que ya existía y es
    // legible por humanos.
    reason?: string
    // El motivo del catálogo cerrado, que es el que se filtra en el panel. Van
    // separados porque uno es prosa histórica y el otro es una faceta.
    logReason?: Extract<
      LogReason,
      "webhook_url_not_configured" | "account_restricted"
    >
    context?: DeliveryLogContext
  } = {}
) {
  const reason = options.reason ?? "webhookUrl not configured"
  await recordDelivery({
    subject,
    webhookUrl: null,
    status: "skipped",
    statusCode: null,
    error: reason,
    attempt: 1,
  })
  log({
    entrypoint: "after",
    action: "webhook_delivery",
    outcome: "skipped",
    reason: options.logReason ?? "webhook_url_not_configured",
    ...options.context,
  })
}

// Reintentos solo ante fallos transitorios (red, timeout, 408/429/5xx); un 4xx
// del endpoint del usuario no se reintenta. Cada intento queda en el log.
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [1000, 3000]

// Sirve a los dos sujetos: el consumidor del tenant y la política de reintentos
// son los mismos para un mensaje y para un comentario, y por eso la migración
// 0013 relajó `external_webhook_deliveries` en vez de crear una segunda tabla.
export async function pushInboundEvent(input: {
  subject: DeliverySubject
  webhookUrl: string
  payload: PushPayload
  context?: DeliveryLogContext
}) {
  const context = input.context ?? {}
  const normalized = normalizeWebhookUrl(input.webhookUrl)
  if (!normalized.ok || !normalized.value) {
    const deliveryError = normalized.ok
      ? "webhookUrl not configured"
      : normalized.error
    await recordDelivery({
      subject: input.subject,
      webhookUrl: input.webhookUrl,
      status: "failed",
      statusCode: null,
      error: deliveryError,
      attempt: 1,
    })
    log({
      entrypoint: "after",
      action: "webhook_delivery",
      outcome: "failed",
      reason: "webhook_url_invalid",
      ...context,
      attempt: 1,
      errorMessage: deliveryError,
    })
    await captureDeliveryFailed(input.payload.tenant.id, {
      ...subjectProperties(input.subject),
      reason: deliveryError,
    })
    return
  }

  const webhookUrl = normalized.value

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now()
    const result = await attemptPush(webhookUrl, input.payload)
    const durationMs = Date.now() - startedAt

    await recordDelivery({
      subject: input.subject,
      webhookUrl,
      status: result.ok ? "success" : "failed",
      statusCode: result.statusCode,
      error: result.error,
      attempt,
    })

    if (result.ok) {
      log({
        entrypoint: "after",
        action: "webhook_delivery",
        outcome: "ok",
        ...context,
        attempt,
        status: result.statusCode ?? undefined,
        durationMs,
      })
      return
    }

    // Se reporta a PostHog solo el fallo definitivo, no cada intento.
    if (!result.retryable || attempt === MAX_ATTEMPTS) {
      log({
        entrypoint: "after",
        action: "webhook_delivery",
        outcome: "failed",
        reason:
          attempt === MAX_ATTEMPTS && result.retryable
            ? "max_attempts_exhausted"
            : result.statusCode === null
              ? "network_error"
              : "http_error",
        ...context,
        attempt,
        status: result.statusCode ?? undefined,
        durationMs,
        errorMessage: result.error ?? undefined,
      })
      await captureDeliveryFailed(input.payload.tenant.id, {
        ...subjectProperties(input.subject),
        status_code: result.statusCode,
        reason: result.error,
        attempt,
      })
      return
    }

    // Cada intento fallido deja su línea. Hasta ahora solo el fallo definitivo
    // llegaba a PostHog, así que un evento que anduvo al tercer intento no
    // dejaba rastro de los dos anteriores en ningún lado salvo la tabla.
    log({
      entrypoint: "after",
      action: "webhook_delivery",
      outcome: "retry",
      reason: result.statusCode === null ? "network_error" : "http_error",
      ...context,
      attempt,
      status: result.statusCode ?? undefined,
      durationMs,
      errorMessage: result.error ?? undefined,
    })

    const delay = RETRY_DELAYS_MS[attempt - 1]
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

async function attemptPush(webhookUrl: string, payload: PushPayload) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })

    return {
      ok: response.ok,
      statusCode: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      retryable:
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
    }
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error: error instanceof Error ? error.message : "unknown push error",
      retryable: true,
    }
  }
}

async function captureDeliveryFailed(
  tenantId: string,
  properties: Record<string, unknown>
) {
  if (!posthog) return
  posthog.capture({
    distinctId: tenantId,
    event: "message delivery failed",
    properties,
  })
  await posthog.flush()
}

// Las propiedades del evento de PostHog nombran el sujeto real. Mandar el id de
// un comentario bajo la clave `message_id` haría que las métricas de entregas
// fallidas mezclaran dos cosas distintas.
function subjectProperties(subject: DeliverySubject) {
  return subject.kind === "comment"
    ? { instagram_comment_id: subject.id }
    : { message_id: subject.id }
}

async function recordDelivery(input: {
  subject: DeliverySubject
  webhookUrl: string | null
  status: "skipped" | "success" | "failed"
  statusCode: number | null
  error: string | null
  attempt: number
}) {
  const sql = getSql()
  // Exactamente una de las dos columnas va informada; la otra es null. El check
  // `num_nonnulls(...) = 1` de la migración 0013 rechaza cualquier otra cosa, y
  // el tipo `DeliverySubject` hace que no se pueda llegar hasta acá con las dos.
  const messageId = input.subject.kind === "message" ? input.subject.id : null
  const commentId = input.subject.kind === "comment" ? input.subject.id : null

  await sql`
    insert into external_webhook_deliveries (
      message_id,
      instagram_comment_id,
      webhook_url,
      status,
      status_code,
      error,
      attempt
    )
    values (
      ${messageId},
      ${commentId},
      ${input.webhookUrl},
      ${input.status},
      ${input.statusCode},
      ${input.error},
      ${input.attempt}
    )
  `
}
