import { addMessage } from "@/lib/message-store"
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

    addMessage({
      id: message.metaMessageId ?? message.id,
      pageId: page.metaPageId,
      senderId: message.contactId,
      text: message.text,
      eventType: event.eventType,
      postbackPayload: event.postbackPayload,
      at: message.createdAt.getTime(),
    })

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
