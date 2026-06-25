export type WebhookUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

export type WebhookUrlMode = "development" | "production"

type WebhookUrlOptions = {
  mode?: WebhookUrlMode
}

export function normalizeWebhookUrl(
  input: unknown,
  options: WebhookUrlOptions = {}
): WebhookUrlResult {
  if (typeof input !== "string") return { ok: true, value: null }

  const value = input.trim()
  if (!value) return { ok: true, value: null }

  try {
    const url = new URL(value)
    if (url.protocol === "https:") {
      return { ok: true, value: url.toString() }
    }

    if (
      url.protocol === "http:" &&
      resolveWebhookUrlMode(options) === "development" &&
      isLocalHttpUrl(url)
    ) {
      return { ok: true, value: url.toString() }
    }

    return {
      ok: false,
      error:
        "The URL must use HTTPS. HTTP is only allowed for localhost in development.",
    }
  } catch {
    return { ok: false, error: "Enter a valid URL." }
  }
}

function resolveWebhookUrlMode(options: WebhookUrlOptions): WebhookUrlMode {
  if (options.mode) return options.mode
  return process.env.NODE_ENV === "production" ? "production" : "development"
}

function isLocalHttpUrl(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1")
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}
