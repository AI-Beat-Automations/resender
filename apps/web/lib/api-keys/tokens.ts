import { createHmac, timingSafeEqual } from "crypto"

export const API_KEY_PREFIX = "pk_live_"

export function hashApiKey(apiKey: string) {
  return createHmac("sha256", getApiKeyPepper())
    .update(apiKey)
    .digest("base64url")
}

export function isApiKeyFormat(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(API_KEY_PREFIX)
}

export function safeEqualHash(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function getApiKeyPepper() {
  const pepper = process.env.API_KEY_PEPPER ?? process.env.AUTH_SECRET
  if (!pepper) throw new Error("API_KEY_PEPPER or AUTH_SECRET is required")
  return pepper
}
