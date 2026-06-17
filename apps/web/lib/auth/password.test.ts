import { describe, expect, it } from "vitest"

import { hashPassword, verifyPassword } from "./password"

describe("password hashing", () => {
  it("verifies the original password and rejects a different password", async () => {
    const hash = await hashPassword("correct-password")

    await expect(verifyPassword("correct-password", hash)).resolves.toBe(true)
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false)
  })
})
