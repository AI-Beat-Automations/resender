import { describe, expect, it } from "vitest"

import {
  HEARD_FROM_OTHER_MAX_LENGTH,
  isHoneypotFilled,
  normalizeWaitlistSource,
  validateWaitlistInput,
} from "./validation"

const valid = {
  email: "user@example.com",
  heardFrom: "tiktok",
  heardFromOther: null,
  consent: "on",
}

describe("waitlist input validation", () => {
  it("normalizes the email before persistence", () => {
    expect(
      validateWaitlistInput({ ...valid, email: "  USER@Example.COM " })
    ).toEqual({
      ok: true,
      value: {
        email: "user@example.com",
        heardFrom: "tiktok",
        heardFromOther: null,
      },
    })
  })

  it("rejects a malformed email", () => {
    expect(validateWaitlistInput({ ...valid, email: "bad" }).ok).toBe(false)
    expect(validateWaitlistInput({ ...valid, email: "" }).ok).toBe(false)
    expect(validateWaitlistInput({ ...valid, email: undefined }).ok).toBe(false)
    expect(validateWaitlistInput({ ...valid, email: "bad" })).toEqual({
      ok: false,
      error: "email",
    })
  })

  it("requires an explicit consent", () => {
    expect(validateWaitlistInput({ ...valid, consent: null })).toEqual({
      ok: false,
      error: "consent",
    })
    expect(validateWaitlistInput({ ...valid, consent: "" }).ok).toBe(false)
    expect(validateWaitlistInput({ ...valid, consent: true }).ok).toBe(true)
    expect(validateWaitlistInput({ ...valid, consent: "true" }).ok).toBe(true)
  })

  it("rejects a heardFrom key outside the whitelist", () => {
    expect(validateWaitlistInput({ ...valid, heardFrom: "Instagram" })).toEqual(
      {
        ok: false,
        error: "heardFrom",
      }
    )
    expect(validateWaitlistInput({ ...valid, heardFrom: "" }).ok).toBe(false)
    expect(validateWaitlistInput({ ...valid, heardFrom: null }).ok).toBe(false)
  })

  it("requires free text when heardFrom is other", () => {
    expect(
      validateWaitlistInput({
        ...valid,
        heardFrom: "other",
        heardFromOther: "   ",
      })
    ).toEqual({ ok: false, error: "heardFromOther" })
  })

  it("caps the free text of other", () => {
    expect(
      validateWaitlistInput({
        ...valid,
        heardFrom: "other",
        heardFromOther: "a".repeat(HEARD_FROM_OTHER_MAX_LENGTH),
      })
    ).toEqual({
      ok: true,
      value: {
        email: "user@example.com",
        heardFrom: "other",
        heardFromOther: "a".repeat(HEARD_FROM_OTHER_MAX_LENGTH),
      },
    })
    expect(
      validateWaitlistInput({
        ...valid,
        heardFrom: "other",
        heardFromOther: "a".repeat(HEARD_FROM_OTHER_MAX_LENGTH + 1),
      })
    ).toEqual({ ok: false, error: "heardFromOtherTooLong" })
  })

  it("trims the free text of other", () => {
    expect(
      validateWaitlistInput({
        ...valid,
        heardFrom: "other",
        heardFromOther: "  un podcast  ",
      })
    ).toEqual({
      ok: true,
      value: {
        email: "user@example.com",
        heardFrom: "other",
        heardFromOther: "un podcast",
      },
    })
  })

  it("drops the free text when the key is not other", () => {
    expect(
      validateWaitlistInput({
        ...valid,
        heardFrom: "event",
        heardFromOther: "una conferencia",
      })
    ).toEqual({
      ok: true,
      value: {
        email: "user@example.com",
        heardFrom: "event",
        heardFromOther: null,
      },
    })
  })
})

describe("waitlist source normalization", () => {
  it("keeps the known sources", () => {
    expect(normalizeWaitlistSource("landing")).toBe("landing")
    expect(normalizeWaitlistSource("waitlist_page")).toBe("waitlist_page")
  })

  it("falls back to landing on an unknown value", () => {
    expect(normalizeWaitlistSource("instagram-ad")).toBe("landing")
    expect(normalizeWaitlistSource(undefined)).toBe("landing")
    expect(normalizeWaitlistSource(42)).toBe("landing")
  })
})

describe("waitlist honeypot", () => {
  it("ignores an empty or absent trap field", () => {
    expect(isHoneypotFilled("")).toBe(false)
    expect(isHoneypotFilled("   ")).toBe(false)
    expect(isHoneypotFilled(null)).toBe(false)
    expect(isHoneypotFilled(undefined)).toBe(false)
  })

  it("detects a filled trap field", () => {
    expect(isHoneypotFilled("Acme Inc")).toBe(true)
  })
})
