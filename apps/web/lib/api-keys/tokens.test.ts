import { describe, expect, it, vi } from "vitest"

import { API_KEY_PREFIX, generateApiKey, hashApiKey, isApiKeyFormat } from "./tokens"

describe("opaque API keys", () => {
  it("generates a visible prefix and stores only a hash", () => {
    vi.stubEnv("API_KEY_PEPPER", "test-pepper")

    const generated = generateApiKey()

    expect(generated.apiKey.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(generated.visiblePrefix.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(generated.apiKey).not.toBe(generated.secretHash)
    expect(generated.secretHash).toBe(hashApiKey(generated.apiKey))

    vi.unstubAllEnvs()
  })

  it("recognizes only Echo API key format", () => {
    expect(isApiKeyFormat("pk_live_abc")).toBe(true)
    expect(isApiKeyFormat("jwt.token.value")).toBe(false)
    expect(isApiKeyFormat(undefined)).toBe(false)
  })
})
