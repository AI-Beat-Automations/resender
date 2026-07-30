export type WebhookUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

export function normalizeWebhookUrl(input: unknown): WebhookUrlResult {
  if (typeof input !== "string") return { ok: true, value: null }

  const value = input.trim()
  if (!value) return { ok: true, value: null }

  try {
    const url = new URL(value)
    if (url.protocol === "https:") {
      return { ok: true, value: url.toString() }
    }

    return {
      ok: false,
      error:
        "La URL tiene que usar HTTPS. Para desarrollo, usa un túnel HTTPS.",
    }
  } catch {
    return { ok: false, error: "Escribe una URL válida." }
  }
}
