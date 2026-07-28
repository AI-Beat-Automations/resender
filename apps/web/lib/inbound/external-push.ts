import { getSql } from "@/lib/db"
import type {
  ConversationRecord,
  MessageRecord,
} from "@/lib/messages/message-log"
import type { ConnectedPageRecord } from "@/lib/pages/page-registry"
import { normalizeWebhookUrl } from "@/lib/pages/webhook-url"
import { posthog } from "@/lib/posthog"
import type { InboundMetaEventType } from "./meta-webhook"

export type InboundPushPayload = {
  tenant: { id: string }
  page: { id: string; metaPageId: string; name: string }
  conversation: { id: string; contactId: string }
  message: {
    id: string
    metaMessageId: string | null
    eventType: InboundMetaEventType
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
  eventType: InboundMetaEventType
  postbackPayload: string | null
}): InboundPushPayload {
  return {
    tenant: { id: input.message.tenantId },
    page: {
      id: input.page.id,
      metaPageId: input.page.metaPageId,
      name: input.page.name,
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

// El motivo es parametrizable porque hay más de una razón para no entregar: la
// página sin `webhookUrl` y la cuenta restringida (ADR 0003), que persiste el
// entrante pero deja de reenviarlo.
export async function recordSkippedDelivery(
  messageId: string,
  reason = "webhookUrl not configured"
) {
  await recordDelivery({
    messageId,
    webhookUrl: null,
    status: "skipped",
    statusCode: null,
    error: reason,
    attempt: 1,
  })
}

// Reintentos solo ante fallos transitorios (red, timeout, 408/429/5xx); un 4xx
// del endpoint del usuario no se reintenta. Cada intento queda en el log.
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [1000, 3000]

export async function pushInboundMessage(input: {
  messageId: string
  webhookUrl: string
  payload: InboundPushPayload
}) {
  const normalized = normalizeWebhookUrl(input.webhookUrl)
  if (!normalized.ok || !normalized.value) {
    const deliveryError = normalized.ok
      ? "webhookUrl not configured"
      : normalized.error
    await recordDelivery({
      messageId: input.messageId,
      webhookUrl: input.webhookUrl,
      status: "failed",
      statusCode: null,
      error: deliveryError,
      attempt: 1,
    })
    await captureDeliveryFailed(input.payload.tenant.id, {
      message_id: input.messageId,
      reason: deliveryError,
    })
    return
  }

  const webhookUrl = normalized.value

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await attemptPush(webhookUrl, input.payload)

    await recordDelivery({
      messageId: input.messageId,
      webhookUrl,
      status: result.ok ? "success" : "failed",
      statusCode: result.statusCode,
      error: result.error,
      attempt,
    })

    if (result.ok) return

    // Se reporta a PostHog solo el fallo definitivo, no cada intento.
    if (!result.retryable || attempt === MAX_ATTEMPTS) {
      await captureDeliveryFailed(input.payload.tenant.id, {
        message_id: input.messageId,
        status_code: result.statusCode,
        reason: result.error,
        attempt,
      })
      return
    }

    const delay = RETRY_DELAYS_MS[attempt - 1]
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

async function attemptPush(webhookUrl: string, payload: InboundPushPayload) {
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

async function recordDelivery(input: {
  messageId: string
  webhookUrl: string | null
  status: "skipped" | "success" | "failed"
  statusCode: number | null
  error: string | null
  attempt: number
}) {
  const sql = getSql()
  await sql`
    insert into external_webhook_deliveries (
      message_id,
      webhook_url,
      status,
      status_code,
      error,
      attempt
    )
    values (
      ${input.messageId},
      ${input.webhookUrl},
      ${input.status},
      ${input.statusCode},
      ${input.error},
      ${input.attempt}
    )
  `
}
