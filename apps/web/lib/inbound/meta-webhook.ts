export type InboundMetaMessage = {
  metaPageId: string
  senderId: string
  text: string
  metaMessageId: string | null
  timestamp: Date
}

type MetaWebhookBody = {
  entry?: Array<{
    id?: unknown
    messaging?: Array<{
      sender?: { id?: unknown }
      timestamp?: unknown
      message?: {
        mid?: unknown
        text?: unknown
      }
    }>
  }>
}

export function extractInboundTextMessages(body: unknown): InboundMetaMessage[] {
  if (!body || typeof body !== "object") return []

  const entries = (body as MetaWebhookBody).entry ?? []
  const messages: InboundMetaMessage[] = []

  for (const entry of entries) {
    if (typeof entry.id !== "string") continue

    for (const event of entry.messaging ?? []) {
      const text = event.message?.text
      if (typeof text !== "string" || text.trim().length === 0) continue

      messages.push({
        metaPageId: entry.id,
        senderId:
          typeof event.sender?.id === "string" ? event.sender.id : "unknown",
        text: text.trim(),
        metaMessageId:
          typeof event.message?.mid === "string" ? event.message.mid : null,
        timestamp: normalizeTimestamp(event.timestamp),
      })
    }
  }

  return messages
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number") return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}
