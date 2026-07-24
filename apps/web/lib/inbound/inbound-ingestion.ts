import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  insertInboundMessage,
  upsertConversation,
  type MessageRecord,
} from "@/lib/messages/message-log"
import {
  getActivePageByMetaPageId,
  type ConnectedPageRecord,
} from "@/lib/pages/page-registry"

import {
  buildInboundPushPayload,
  pushInboundMessage,
  recordSkippedDelivery,
} from "./external-push"
import { extractInboundEvents } from "./meta-webhook"
import { posthog } from "@/lib/posthog"

export type InboundPushJob = () => Promise<void>

export type IngestedInboundMessage = {
  page: ConnectedPageRecord
  message: MessageRecord
  pushJob: InboundPushJob
}

export async function ingestMetaWebhookPayload(body: unknown) {
  const incoming = extractInboundEvents(body)
  const ingested: IngestedInboundMessage[] = []

  for (const event of incoming) {
    const page = await getActivePageByMetaPageId(event.metaPageId)
    if (!page) continue

    // Bloqueo total sin suscripción activa (ADR 0002): el entrante del tenant
    // se descarta sin persistir ni reenviar; esos mensajes se pierden a
    // propósito. El webhook responde 200 a Meta igualmente.
    if (!(await hasActiveSubscription(page.tenantId))) continue

    const conversation = await upsertConversation({
      tenantId: page.tenantId,
      connectedPageId: page.id,
      contactId: event.senderId,
      lastMessageAt: event.timestamp,
    })
    const { message, inserted } = await insertInboundMessage({
      tenantId: page.tenantId,
      conversationId: conversation.id,
      connectedPageId: page.id,
      contactId: event.senderId,
      text: event.text,
      metaMessageId: event.metaMessageId,
      createdAt: event.timestamp,
    })

    if (!inserted) continue

    if (posthog) {
      posthog.capture({
        distinctId: page.tenantId,
        event: "message received",
        properties: {
          message_id: message.id,
          conversation_id: conversation.id,
          page_id: page.metaPageId,
          event_type: event.eventType,
        },
      })
      await posthog.flush()
    }

    const payload = buildInboundPushPayload({
      page,
      conversation,
      message,
      eventType: event.eventType,
      postbackPayload: event.postbackPayload,
    })
    const webhookUrl = page.webhookUrl
    const pushJob = webhookUrl
      ? () =>
          pushInboundMessage({
            messageId: message.id,
            webhookUrl,
            payload,
          })
      : () => recordSkippedDelivery(message.id)

    ingested.push({ page, message, pushJob })
  }

  return ingested
}
