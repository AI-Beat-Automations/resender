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
    const metaError = extractMetaErrorMessage(data)
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok
        ? null
        : (metaError ?? `Meta returned HTTP ${response.status}`),
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

export function isMetaExpiredTokenError(data: unknown) {
  return extractMetaErrorCode(data) === 190
}

export function extractMetaErrorMessage(data: unknown) {
  const error = extractMetaError(data)
  const message = error?.message
  return typeof message === "string" && message.trim().length > 0
    ? message.trim()
    : null
}

export function extractMetaErrorCode(data: unknown) {
  const error = extractMetaError(data)
  const code = error?.code
  if (typeof code === "number") return code
  if (typeof code === "string" && code.trim().length > 0) {
    const parsed = Number(code)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function extractMetaError(data: unknown) {
  if (!data || typeof data !== "object") return null
  const error = (data as Record<string, unknown>).error
  if (!error || typeof error !== "object") return null
  return error as Record<string, unknown>
}
