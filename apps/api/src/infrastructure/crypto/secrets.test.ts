import { describe, expect, it } from "vitest"

import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  hashApiKey,
  hashPassword,
  safeEqualText,
  verifyPassword,
} from "./secrets"

const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex")

describe("credential and secret primitives", () => {
  it("verifies scrypt password hashes and rejects another password", async () => {
    const hash = await hashPassword("correct horse")
    await expect(verifyPassword("correct horse", hash)).resolves.toBe(true)
    await expect(verifyPassword("wrong battery", hash)).resolves.toBe(false)
  })

  it("keeps the canonical eight-character password minimum", async () => {
    await expect(hashPassword("1234567")).rejects.toMatchObject({
      code: "validation_error",
      status: 400,
    })
    await expect(hashPassword("12345678")).resolves.toMatch(/^scrypt\$/u)
  })

  it("hashes API keys with the configured pepper and exposes only a prefix", async () => {
    const generated = await generateApiKey("pepper")
    expect(generated.apiKey).toMatch(/^pk_live_/u)
    expect(generated.visiblePrefix.length).toBeLessThan(generated.apiKey.length)
    await expect(hashApiKey("pepper", generated.apiKey)).resolves.toBe(
      generated.secretHash
    )
  })

  it("encrypts at rest using authenticated encryption", () => {
    const encrypted = encryptSecret(ENCRYPTION_KEY, "provider-token")
    expect(encrypted).not.toContain("provider-token")
    expect(decryptSecret(ENCRYPTION_KEY, encrypted)).toBe("provider-token")
    expect(() =>
      decryptSecret(ENCRYPTION_KEY, `${encrypted.slice(0, -2)}aa`)
    ).toThrow()
  })

  it("compares signature text without length-sensitive early returns", async () => {
    await expect(safeEqualText("same", "same")).resolves.toBe(true)
    await expect(safeEqualText("short", "a much longer value")).resolves.toBe(
      false
    )
  })
})
