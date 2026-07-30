import { describe, expect, it } from "vitest"

import { isApiKeyFormat } from "./tokens"

describe("opaque API keys", () => {
  it("recognizes only Resender API key format", () => {
    expect(isApiKeyFormat("pk_live_abc")).toBe(true)
    expect(isApiKeyFormat("jwt.token.value")).toBe(false)
    expect(isApiKeyFormat(undefined)).toBe(false)
  })
})
