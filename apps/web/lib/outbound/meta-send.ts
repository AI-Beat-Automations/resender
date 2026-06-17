const GRAPH = "https://graph.facebook.com/v23.0"

export type MetaSendResult = {
  ok: boolean
  status: number
  data: unknown
  error: string | null
}

export async function sendMetaTextMessage(input: {
  pageId: string
  pageAccessToken: string
  recipientId: string
  text: string
}): Promise<MetaSendResult> {
  try {
    const response = await fetch(
      `${GRAPH}/${input.pageId}/messages?access_token=${encodeURIComponent(input.pageAccessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          recipient: { id: input.recipientId },
          messaging_type: "RESPONSE",
          message: { text: input.text },
        }),
      }
    )

    const data = await response.json().catch(() => null)
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : `Meta returned HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: error instanceof Error ? error.message : "Meta request failed",
    }
  }
}

export function extractMetaMessageId(data: unknown) {
  if (!data || typeof data !== "object") return null
  const messageId = (data as Record<string, unknown>).message_id
  return typeof messageId === "string" ? messageId : null
}
