import { describe, expect, it } from "vitest"

import { normalizeWebhookUrl } from "./webhook-url"

describe("webhook URL normalization", () => {
  it("stores empty values as null", () => {
    expect(normalizeWebhookUrl("   ")).toEqual({ ok: true, value: null })
  })

  it("allows http and https URLs", () => {
    expect(normalizeWebhookUrl("https://example.com/hook")).toEqual({
      ok: true,
      value: "https://example.com/hook",
    })
    expect(normalizeWebhookUrl("http://localhost:3000/hook").ok).toBe(true)
  })

  it("rejects unsupported or malformed URLs", () => {
    expect(normalizeWebhookUrl("ftp://example.com").ok).toBe(false)
    expect(normalizeWebhookUrl("not-a-url").ok).toBe(false)
  })
})
