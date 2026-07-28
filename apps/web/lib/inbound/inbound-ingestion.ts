import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import {
  countsTowardQuota,
  shouldPushInbound,
  type TenantEntitlement,
} from "@/lib/billing/entitlements"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { incrementUsage } from "@/lib/billing/usage-counter"
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

// Motivo del `skipped` cuando la cuenta está restringida (ADR 0003): el
// entrante se persiste y consume cuota, pero no se reenvía.
const RESTRICTED_SKIP_REASON =
  "account is restricted: quota exhausted or too many connected Pages"

export async function ingestMetaWebhookPayload(body: unknown) {
  const incoming = extractInboundEvents(body)
  const ingested: IngestedInboundMessage[] = []
  // Un payload de Meta puede traer varios eventos del mismo tenant; el
  // entitlement se resuelve una sola vez por tenant y por payload.
  const entitlements = new Map<string, TenantEntitlement>()

  for (const event of incoming) {
    const page = await getActivePageByMetaPageId(event.metaPageId)
    if (!page) continue

    // Bloqueo total sin suscripción activa (ADR 0002): el entrante del tenant
    // se descarta sin persistir ni reenviar; esos mensajes se pierden a
    // propósito. El webhook responde 200 a Meta igualmente.
    if (!(await hasActiveSubscription(page.tenantId))) continue

    let entitlement = entitlements.get(page.tenantId)
    if (!entitlement) {
      entitlement = await getTenantEntitlement(page.tenantId)
      entitlements.set(page.tenantId, entitlement)
    }

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

    // El entrante persistido consume cuota aunque la cuenta esté restringida o
    // la página no tenga `webhookUrl`: lo que se cobra es recibir y persistir,
    // no entregar. Best-effort — el contador nunca puede romper la ingesta.
    const periodStart = entitlement.periodStart
    if (
      periodStart &&
      countsTowardQuota({ kind: "inbound", persisted: true })
    ) {
      try {
        await incrementUsage(page.tenantId, periodStart)
      } catch (error) {
        console.error("failed to increment usage counter", page.tenantId, error)
      }
    }

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
    let pushJob: InboundPushJob
    if (!shouldPushInbound(entitlement)) {
      // Cuenta restringida (ADR 0003): el mensaje ya quedó persistido y
      // contabilizado, pero deja de reenviarse al webhook del cliente.
      pushJob = () => recordSkippedDelivery(message.id, RESTRICTED_SKIP_REASON)
    } else if (webhookUrl) {
      pushJob = () =>
        pushInboundMessage({
          messageId: message.id,
          webhookUrl,
          payload,
        })
    } else {
      pushJob = () => recordSkippedDelivery(message.id)
    }

    ingested.push({ page, message, pushJob })
  }

  return ingested
}
