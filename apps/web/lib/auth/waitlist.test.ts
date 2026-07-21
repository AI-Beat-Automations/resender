import { describe, expect, it } from "vitest"

import { hasProductAccess } from "./waitlist"

describe("waitlist access", () => {
  it("grants access only when the flag is explicitly false", () => {
    expect(hasProductAccess({ waitlisted: false })).toBe(true)
  })

  it("denies access to a waitlisted account", () => {
    expect(hasProductAccess({ waitlisted: true })).toBe(false)
  })

  it("fails closed when the user row is missing", () => {
    expect(hasProductAccess(null)).toBe(false)
    expect(hasProductAccess(undefined)).toBe(false)
  })
})
