export const API_DEFAULT_LIMIT = 25
export const API_MAX_LIMIT = 100
export const API_JSON_BODY_LIMIT_BYTES = 64 * 1024
export const PROVIDER_BODY_LIMIT_BYTES = 256 * 1024
export const META_TIMEOUT_MS = 10_000
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 5_000
export const RECOVERY_BATCH_SIZE = 100
export const RECOVERY_HANDOFF_GRACE_SECONDS = 120
export const RECOVERY_PROCESSING_TIMEOUT_SECONDS = 120
export const RECOVERY_RETRY_GRACE_SECONDS = 120
export const QUEUE_RETRY_DELAYS_SECONDS = [5, 30, 120, 300, 900] as const
export const WEBHOOK_PAYLOAD_VERSION = 1
export const OPENAPI_VERSION = "1.0.0"
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200

export type RateLimitFamily =
  | "read"
  | "message_send"
  | "page_write"
  | "secret_rotation"

export function rateLimitFamily(
  method: string,
  pathname: string
): RateLimitFamily {
  if (method !== "POST") {
    return method === "PATCH" ? "page_write" : "read"
  }
  if (pathname === "/v1/messages") return "message_send"
  // Las respuestas a comentarios comparten cubeta con el envío de mensajes y no
  // con las escrituras de página: son la misma clase de operación —salir hacia
  // Meta por cada evento entrante— y el ritmo que hay que contener es el mismo.
  // Con cubetas separadas, un tenant que contesta comentarios podría duplicar su
  // presión sobre Graph sin tocar su límite de mensajes.
  if (/^\/v1\/comments\/[^/]+\/(replies|private-replies)$/u.test(pathname)) {
    return "message_send"
  }
  if (pathname.endsWith("/webhook-secret/rotate")) return "secret_rotation"
  return "page_write"
}
