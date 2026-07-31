export const API_DEFAULT_LIMIT = 25
export const API_MAX_LIMIT = 100
export const API_JSON_BODY_LIMIT_BYTES = 64 * 1024
export const LEGACY_SEND_BODY_LIMIT_BYTES = 64 * 1024
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
  if (pathname === "/v1/messages" && method === "POST") return "message_send"
  if (pathname.endsWith("/webhook-secret/rotate")) return "secret_rotation"
  if (method === "PATCH" || method === "POST") return "page_write"
  return "read"
}
