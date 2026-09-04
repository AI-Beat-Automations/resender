import { describe, expect, it } from "vitest"

import { allowApiKeyRequest } from "@/lib/auth/api-key-rate-limit"

// Mismo criterio que `rate-limit.test.ts`: se prueba la decisión, no la red.
// El binding `ratelimits` solo existe dentro del Worker.
describe("allowApiKeyRequest", () => {
  it("deja pasar cuando no hay binding (fail-open explícito)", async () => {
    await expect(allowApiKeyRequest("key-1")).resolves.toBe(true)
  })
})
