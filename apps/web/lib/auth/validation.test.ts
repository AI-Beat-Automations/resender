import { describe, expect, it } from "vitest"

import {
  normalizeEmail,
  validateAuthInput,
  validatePasswordChangeInput,
} from "./validation"

describe("auth input validation", () => {
  it("normalizes email before persistence and login", () => {
    expect(normalizeEmail("  USER@Example.COM ")).toBe("user@example.com")
  })

  it("requires a valid email and an 8 character password", () => {
    expect(validateAuthInput("bad", "12345678").ok).toBe(false)
    expect(validateAuthInput("user@example.com", "1234567").ok).toBe(false)
    expect(validateAuthInput("user@example.com", "12345678")).toEqual({
      ok: true,
      value: { email: "user@example.com", password: "12345678" },
    })
  })

  it("validates password change confirmation", () => {
    expect(validatePasswordChangeInput("1234567", "1234567")).toEqual({
      ok: false,
      error: "Password must be at least 8 characters.",
    })
    expect(validatePasswordChangeInput("12345678", "different")).toEqual({
      ok: false,
      error: "Passwords don't match.",
    })
    expect(validatePasswordChangeInput("12345678", "12345678")).toEqual({
      ok: true,
      value: { password: "12345678" },
    })
  })
})
