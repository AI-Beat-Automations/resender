import { describe, expect, it } from "vitest"

import { normalizeWebhookUrl } from "./webhook-url"

describe("webhook URL normalization", () => {
  it("stores empty values as null", () => {
    expect(normalizeWebhookUrl("   ")).toEqual({ ok: true, value: null })
  })

  it("allows https URLs in production", () => {
    expect(
      normalizeWebhookUrl("https://example.com/hook", { mode: "production" })
    ).toEqual({
      ok: true,
      value: "https://example.com/hook",
    })
  })

  it("allows local http URLs in development", () => {
    expect(
      normalizeWebhookUrl("http://localhost:3000/hook", {
        mode: "development",
      }).ok
    ).toBe(true)
    expect(
      normalizeWebhookUrl("http://127.0.0.1:3000/hook", {
        mode: "development",
      }).ok
    ).toBe(true)
    expect(
      normalizeWebhookUrl("http://[::1]:3000/hook", {
        mode: "development",
      }).ok
    ).toBe(true)
  })

  it("rejects remote http URLs", () => {
    expect(
      normalizeWebhookUrl("http://example.com/hook", { mode: "development" }).ok
    ).toBe(false)
  })

  it("rejects local http URLs in production", () => {
    expect(
      normalizeWebhookUrl("http://localhost:3000/hook", {
        mode: "production",
      }).ok
    ).toBe(false)
  })

  it("rejects unsupported or malformed URLs", () => {
    expect(normalizeWebhookUrl("ftp://example.com").ok).toBe(false)
    expect(normalizeWebhookUrl("not-a-url").ok).toBe(false)
  })
})
