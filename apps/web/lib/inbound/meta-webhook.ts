export type InboundMetaEventType = "message" | "postback"

export type InboundMetaEvent = {
  eventType: InboundMetaEventType
  metaPageId: string
  senderId: string
  text: string
  metaMessageId: string | null
  postbackPayload: string | null
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
      postback?: {
        mid?: unknown
        title?: unknown
        payload?: unknown
      }
    }>
  }>
}

export function extractInboundEvents(body: unknown): InboundMetaEvent[] {
  if (!body || typeof body !== "object") return []

  const entries = (body as MetaWebhookBody).entry ?? []
  const events: InboundMetaEvent[] = []

  for (const entry of entries) {
    if (typeof entry.id !== "string") continue

    for (const event of entry.messaging ?? []) {
      const senderId =
        typeof event.sender?.id === "string" ? event.sender.id : "unknown"
      const timestamp = normalizeTimestamp(event.timestamp)
      const text = event.message?.text
      if (typeof text === "string" && text.trim().length > 0) {
        events.push({
          eventType: "message",
          metaPageId: entry.id,
          senderId,
          text: text.trim(),
          metaMessageId:
            typeof event.message?.mid === "string" ? event.message.mid : null,
          postbackPayload: null,
          timestamp,
        })
        continue
      }

      const postback = event.postback
      if (!postback) continue

      const payload = postback.payload
      if (typeof payload !== "string" || payload.trim().length === 0) continue

      const postbackPayload = payload.trim()
      const title = typeof postback.title === "string" ? postback.title.trim() : ""

      events.push({
        eventType: "postback",
        metaPageId: entry.id,
        senderId,
        text: formatPostbackText(postbackPayload, title),
        metaMessageId:
          typeof postback.mid === "string"
            ? postback.mid
            : buildSyntheticPostbackId({
                metaPageId: entry.id,
                senderId,
                timestamp: event.timestamp,
                payload: postbackPayload,
              }),
        postbackPayload,
        timestamp,
      })
    }
  }

  return events
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number") return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function formatPostbackText(payload: string, title: string) {
  if (payload === "GET_STARTED") return "GET_STARTED"
  return title ? `${title} (${payload})` : `POSTBACK:${payload}`
}

function buildSyntheticPostbackId(input: {
  metaPageId: string
  senderId: string
  timestamp: unknown
  payload: string
}) {
  const timestamp =
    typeof input.timestamp === "number" ? String(input.timestamp) : "unknown"
  const encodedPayload = Buffer.from(input.payload).toString("base64url")
  return `postback:${input.metaPageId}:${input.senderId}:${timestamp}:${encodedPayload}`
}
