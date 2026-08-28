/**
 * Por qué no vale la URL. Es un **código y no un mensaje** porque este módulo lo
 * comparten dos llamadores con destinos distintos: la pantalla de Conexiones,
 * que se lo enseña a una persona en su idioma, y la entrega de webhooks
 * (`lib/inbound/webhook-delivery.ts`), que corre en un job y no tiene idioma
 * ninguno. El texto se resuelve en el borde, contra `t.actions`.
 */
export type WebhookUrlError = "not_https" | "invalid_url"

export type WebhookUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; error: WebhookUrlError }

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

    return { ok: false, error: "not_https" }
  } catch {
    return { ok: false, error: "invalid_url" }
  }
}

function resolveWebhookUrlMode(options: WebhookUrlOptions): WebhookUrlMode {
  if (options.mode) return options.mode
  return process.env.NODE_ENV === "production" ? "production" : "development"
}

function isLocalHttpUrl(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1")
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  )
}
