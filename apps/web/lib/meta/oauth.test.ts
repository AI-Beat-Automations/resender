import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildMetaDialogUrl,
  configuredAppOrigin,
  expiredMetaStateCookieOptions,
  metaRedirectUri,
  metaStateCookieOptions,
  serializeMetaState,
  validateMetaState,
} from "./oauth"

const STATE = "5e052bb8-a52b-40b7-bc03-39fd193f6f50"
const NOW = 1_900_000_000_000

describe("Meta OAuth browser state", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://resender.dev"
    process.env.NEXT_PUBLIC_META_APP_ID = "app_123"
    process.env.NEXT_PUBLIC_META_CONFIG_ID = "config_123"
    process.env.AUTH_SECRET = "test-only-state-signing-secret"
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, "APP_URL")
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_APP_ID")
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_CONFIG_ID")
    Reflect.deleteProperty(process.env, "AUTH_SECRET")
  })

  it("uses the exact configured origin for both OAuth redirects", () => {
    expect(configuredAppOrigin().toString()).toBe("https://resender.dev/")
    expect(metaRedirectUri()).toBe("https://resender.dev/api/meta/callback")

    const dialog = new URL(buildMetaDialogUrl(STATE))
    expect(dialog.origin).toBe("https://www.facebook.com")
    expect(dialog.searchParams.get("redirect_uri")).toBe(metaRedirectUri())
    expect(dialog.searchParams.get("state")).toBe(STATE)
  })

  it.each([
    "https://evil.example/path",
    "https://resender.dev?next=https://evil.example",
    "https://user:password@resender.dev",
    "http://resender.dev",
  ])("rejects non-origin APP_URL %s", (appUrl) => {
    process.env.APP_URL = appUrl
    expect(() => configuredAppOrigin()).toThrow(
      "APP_URL must be an exact public origin."
    )
  })

  it("allows insecure HTTP only for local development origins", () => {
    process.env.APP_URL = "http://localhost:3000"
    expect(metaStateCookieOptions().secure).toBe(false)
  })

  it("sets and expires a scoped, HttpOnly state cookie", () => {
    expect(metaStateCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
      priority: "high",
    })
    expect(expiredMetaStateCookieOptions()).toEqual({
      ...metaStateCookieOptions(),
      maxAge: 0,
    })
  })

  it("accepts a fresh matching state and rejects missing, mismatched, replayed, and expired state", () => {
    const cookie = serializeMetaState(STATE, NOW)
    expect(validateMetaState(STATE, cookie, NOW + 1_000)).toBe("valid")
    expect(validateMetaState(null, cookie, NOW)).toBe("missing")
    expect(validateMetaState(STATE, undefined, NOW)).toBe("missing")
    expect(
      validateMetaState("4ed23e02-b81b-46aa-aec5-bca3fa2470e8", cookie, NOW)
    ).toBe("mismatch")
    expect(validateMetaState(STATE, cookie, NOW + 600_001)).toBe("expired")
    expect(validateMetaState(STATE, "not-a-cookie", NOW)).toBe("mismatch")
  })

  it("rejects tampering with either the state or its issued-at timestamp", () => {
    const cookie = serializeMetaState(STATE, NOW)
    expect(
      validateMetaState(
        STATE,
        cookie.replace(String(NOW), String(NOW + 1)),
        NOW
      )
    ).toBe("mismatch")
    expect(
      validateMetaState(
        STATE,
        cookie.replace(STATE, "4ed23e02-b81b-46aa-aec5-bca3fa2470e8"),
        NOW
      )
    ).toBe("mismatch")
  })

  it.each([
    `${NOW}.${STATE}`,
    `${NOW}..${"a".repeat(43)}`,
    `${NOW}.${STATE}.`,
    `.${STATE}.${"a".repeat(43)}`,
    `${NOW}.${STATE}.${"a".repeat(42)}`,
    `${NOW}.${STATE}.${"a".repeat(44)}`,
  ])("rejects malformed state with missing or invalid groups: %s", (cookie) => {
    expect(validateMetaState(STATE, cookie, NOW)).toBe("mismatch")
  })
})
