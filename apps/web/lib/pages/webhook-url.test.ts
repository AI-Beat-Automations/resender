import { describe, expect, it } from "vitest"

import { normalizeWebhookUrl } from "./webhook-url"

describe("webhook URL normalization", () => {
  it("stores empty values as null", () => {
    expect(normalizeWebhookUrl("   ")).toEqual({ ok: true, value: null })
  })

  it("allows https URLs", () => {
    expect(normalizeWebhookUrl("https://example.com/hook")).toEqual({
      ok: true,
      value: "https://example.com/hook",
    })
  })

  it.each([
    "http://example.com/hook",
    "http://localhost:3000/hook",
    "http://127.0.0.1:3000/hook",
    "http://[::1]:3000/hook",
  ])("rejects HTTP URLs, including local destinations", (url) => {
    expect(normalizeWebhookUrl(url)).toEqual({
      ok: false,
      error:
        "La URL tiene que usar HTTPS. Para desarrollo, usa un túnel HTTPS.",
    })
  })

  it("rejects unsupported or malformed URLs", () => {
    expect(normalizeWebhookUrl("ftp://example.com").ok).toBe(false)
    expect(normalizeWebhookUrl("not-a-url").ok).toBe(false)
  })
})
