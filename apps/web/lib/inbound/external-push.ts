import { getSql } from "@/lib/db"
import type { ConversationRecord, MessageRecord } from "@/lib/messages/message-log"
import type { ConnectedPageRecord } from "@/lib/pages/page-registry"
import { normalizeWebhookUrl } from "@/lib/pages/webhook-url"

export type InboundPushPayload = {
  tenant: { id: string }
  page: { id: string; metaPageId: string; name: string }
  conversation: { id: string; contactId: string }
  message: {
    id: string
    metaMessageId: string | null
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
      direction: "inbound",
      status: "received",
      text: input.message.text,
      createdAt: input.message.createdAt.toISOString(),
    },
  }
}

export async function recordSkippedDelivery(messageId: string) {
  await recordDelivery({
    messageId,
    webhookUrl: null,
    status: "skipped",
    statusCode: null,
    error: "webhookUrl not configured",
  })
}

export async function pushInboundMessage(input: {
  messageId: string
  webhookUrl: string
  payload: InboundPushPayload
}) {
  const normalized = normalizeWebhookUrl(input.webhookUrl)
  if (!normalized.ok || !normalized.value) {
    await recordDelivery({
      messageId: input.messageId,
      webhookUrl: input.webhookUrl,
      status: "failed",
      statusCode: null,
      error: normalized.ok ? "webhookUrl not configured" : normalized.error,
    })
    return
  }

  const webhookUrl = normalized.value

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(5000),
    })

    await recordDelivery({
      messageId: input.messageId,
      webhookUrl,
      status: response.ok ? "success" : "failed",
      statusCode: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    })
  } catch (error) {
    await recordDelivery({
      messageId: input.messageId,
      webhookUrl,
      status: "failed",
      statusCode: null,
      error: error instanceof Error ? error.message : "unknown push error",
    })
  }
}

async function recordDelivery(input: {
  messageId: string
  webhookUrl: string | null
  status: "skipped" | "success" | "failed"
  statusCode: number | null
  error: string | null
}) {
  const sql = getSql()
  await sql`
    insert into external_webhook_deliveries (
      message_id,
      webhook_url,
      status,
      status_code,
      error
    )
    values (
      ${input.messageId},
      ${input.webhookUrl},
      ${input.status},
      ${input.statusCode},
      ${input.error}
    )
  `
}
