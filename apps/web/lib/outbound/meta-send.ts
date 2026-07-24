const GRAPH = "https://graph.facebook.com/v23.0"

export type MetaSendResult = {
  ok: boolean
  status: number
  data: unknown
  // `error`: mensaje crudo de Meta; `reason`: traducción accionable (o null
  // si el error no está en el catálogo de casos conocidos).
  error: string | null
  reason: string | null
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
      reason: response.ok ? null : explainMetaError(data),
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: error instanceof Error ? error.message : "Meta request failed",
      reason:
        "Could not reach Meta's Send API (network error or timeout). Retry shortly.",
    }
  }
}

// Traduce los errores más comunes del Send API a un motivo accionable.
// Referencia: https://developers.facebook.com/docs/messenger-platform/error-codes
export function explainMetaError(data: unknown): string | null {
  const code = extractMetaErrorCode(data)
  if (code === null) return null
  const subcode = extractMetaErrorSubcode(data)

  if (code === 190) {
    return "The Page access token expired or was revoked. Reconnect the Page in Resender."
  }
  if (code === 10 && subcode === 2018278) {
    return "Messenger's 24-hour window is closed: this contact hasn't messaged the Page in the last 24 hours, so Meta rejects new messages until they write again."
  }
  if (code === 10) {
    return "Meta permission error: the app or Page is missing the pages_messaging permission for this send."
  }
  if (code === 551) {
    return "This person isn't available: they may have blocked the Page, deleted the conversation, or deactivated their account."
  }
  if (code === 100 && subcode === 2018001) {
    return "No matching user found: the recipient ID (PSID) doesn't belong to this Page."
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return "Meta rate limit reached for this app or Page. Retry later."
  }
  if (code === 368) {
    return "The Page is temporarily blocked from sending messages due to a policy violation on Meta's side."
  }
  return null
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

export function extractMetaErrorSubcode(data: unknown) {
  const error = extractMetaError(data)
  const subcode = error?.error_subcode
  return typeof subcode === "number" ? subcode : null
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
