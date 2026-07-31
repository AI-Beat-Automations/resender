import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

const GRAPH_VERSION = "v23.0"
const STATE_TTL_SECONDS = 10 * 60
const STATE_FUTURE_SKEW_MS = 30_000
const STATE_PATTERN =
  /^(?<issuedAt>[1-9][0-9]{12})\.(?<state>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?<signature>[A-Za-z0-9_-]{43})$/u

export const META_STATE_COOKIE = "meta_oauth_state"

export type MetaStateCookieOptions = {
  httpOnly: true
  secure: boolean
  sameSite: "lax"
  path: "/"
  maxAge: number
  priority: "high"
}

export function configuredAppOrigin(): URL {
  const configured = process.env.APP_URL
  if (!configured) throw new Error("APP_URL is not configured.")

  const url = new URL(configured)
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")

  if (
    (url.protocol !== "https:" && !isLocalHttp) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_URL must be an exact public origin.")
  }

  return url
}

export function metaRedirectUri(): string {
  return new URL("/api/meta/callback", configuredAppOrigin()).toString()
}

export function buildMetaDialogUrl(state: string): string {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID
  if (!appId || !configId) {
    throw new Error("Meta OAuth public configuration is missing.")
  }

  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set("client_id", appId)
  url.searchParams.set("config_id", configId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", metaRedirectUri())
  url.searchParams.set("state", state)
  return url.toString()
}

export function serializeMetaState(
  state: string,
  issuedAt = Date.now()
): string {
  const payload = `${issuedAt}.${state}`
  return `${payload}.${signState(payload)}`
}

export function validateMetaState(
  returnedState: string | null,
  cookieValue: string | undefined,
  now = Date.now()
): "valid" | "missing" | "mismatch" | "expired" {
  if (!returnedState || !cookieValue) return "missing"

  const match = STATE_PATTERN.exec(cookieValue)
  if (!match?.groups) return "mismatch"

  const { issuedAt, state, signature } = match.groups
  if (!issuedAt || !state || !signature) return "mismatch"

  const payload = `${issuedAt}.${state}`
  const expectedSignature = Buffer.from(signState(payload))
  const actualSignature = Buffer.from(signature)
  if (
    expectedSignature.byteLength !== actualSignature.byteLength ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return "mismatch"
  }

  const issuedAtNumber = Number(issuedAt)
  if (
    !Number.isSafeInteger(issuedAtNumber) ||
    issuedAtNumber > now + STATE_FUTURE_SKEW_MS ||
    now - issuedAtNumber > STATE_TTL_SECONDS * 1000
  ) {
    return "expired"
  }

  const expected = Buffer.from(state)
  const actual = Buffer.from(returnedState)
  if (
    expected.byteLength !== actual.byteLength ||
    !timingSafeEqual(expected, actual)
  ) {
    return "mismatch"
  }

  return "valid"
}

function signState(payload: string): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not configured.")
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

export function metaStateCookieOptions(): MetaStateCookieOptions {
  return {
    httpOnly: true,
    secure: configuredAppOrigin().protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
    priority: "high",
  }
}

export function expiredMetaStateCookieOptions(): MetaStateCookieOptions {
  return { ...metaStateCookieOptions(), maxAge: 0 }
}
