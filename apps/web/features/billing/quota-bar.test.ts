import { describe, expect, it } from "vitest"

import { resolveQuotaBar } from "./quota-bar"

describe("quota bar presentation", () => {
  it("keeps unavailable, warning and capped states presentational", () => {
    expect(resolveQuotaBar({ usage: 1, limit: null })).toEqual({
      available: false,
    })
    expect(resolveQuotaBar({ usage: 80, limit: 100 })).toMatchObject({
      available: true,
      percentage: 80,
      tone: "warning",
    })
    expect(resolveQuotaBar({ usage: 120, limit: 100 })).toMatchObject({
      available: true,
      percentage: 100,
      tone: "destructive",
    })
  })
})
