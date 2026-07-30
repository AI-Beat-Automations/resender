export type InboundMetaEvent = {
  providerPageId: string
  senderId: string
  text: string
  providerMessageId: string
  createdAt: Date
}

type MetaWebhookBody = {
  entry?: Array<{
    id?: unknown
    messaging?: Array<{
      sender?: { id?: unknown }
      timestamp?: unknown
      message?: { mid?: unknown; text?: unknown }
      postback?: { mid?: unknown; title?: unknown; payload?: unknown }
    }>
  }>
}

export async function extractInboundMetaEvents(
  value: unknown
): Promise<InboundMetaEvent[]> {
  if (!value || typeof value !== "object") return []
  const events: InboundMetaEvent[] = []

  for (const entry of (value as MetaWebhookBody).entry ?? []) {
    if (typeof entry.id !== "string") continue
    for (const item of entry.messaging ?? []) {
      const senderId =
        typeof item.sender?.id === "string" ? item.sender.id : null
      if (!senderId) continue
      const createdAt =
        typeof item.timestamp === "number" &&
        !Number.isNaN(new Date(item.timestamp).getTime())
          ? new Date(item.timestamp)
          : new Date()

      if (
        typeof item.message?.mid === "string" &&
        typeof item.message.text === "string" &&
        item.message.text.trim()
      ) {
        events.push({
          providerPageId: entry.id,
          senderId,
          text: item.message.text.trim(),
          providerMessageId: item.message.mid,
          createdAt,
        })
        continue
      }

      if (
        item.postback &&
        typeof item.postback.payload === "string" &&
        item.postback.payload.trim()
      ) {
        const payload = item.postback.payload.trim()
        const title =
          typeof item.postback.title === "string"
            ? item.postback.title.trim()
            : ""
        const providerMessageId =
          typeof item.postback.mid === "string"
            ? item.postback.mid
            : await syntheticPostbackId({
                pageId: entry.id,
                senderId,
                timestamp: item.timestamp,
                payload,
              })
        events.push({
          providerPageId: entry.id,
          senderId,
          text:
            payload === "GET_STARTED"
              ? "GET_STARTED"
              : title
                ? `${title} (${payload})`
                : `POSTBACK:${payload}`,
          providerMessageId,
          createdAt,
        })
      }
    }
  }
  return events
}

async function syntheticPostbackId(input: {
  pageId: string
  senderId: string
  timestamp: unknown
  payload: string
}): Promise<string> {
  const source = [
    input.pageId,
    input.senderId,
    typeof input.timestamp === "number" ? input.timestamp : "unknown",
    input.payload,
  ].join(":")
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source)
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `postback:${hex}`
}
