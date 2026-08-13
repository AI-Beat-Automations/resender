import { describe, expect, it } from "vitest"

import {
  entitlementHttpError,
  evaluateEntitlement,
  PLAN_LIMITS,
} from "./entitlements"

const period = {
  currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
  now: new Date("2026-07-29T00:00:00.000Z"),
}

describe("evaluateEntitlement", () => {
  it("allows an active canonical plan within both limits", () => {
    expect(
      evaluateEntitlement({
        ...period,
        priceLookupKey: "starter_monthly",
        usage: 49_999,
        activeAccountCount: 2,
      })
    ).toMatchObject({
      priceLookupKey: "starter_monthly",
      blockCode: null,
      limits: PLAN_LIMITS.starter_monthly,
    })
  })

  it.each([
    {
      name: "unknown plan",
      priceLookupKey: "legacy",
      usage: 0,
      activeAccountCount: 0,
      blockCode: "plan_unavailable",
    },
    {
      name: "message quota",
      priceLookupKey: "starter_monthly",
      usage: 50_000,
      activeAccountCount: 1,
      blockCode: "quota_exceeded",
    },
    {
      name: "page limit",
      priceLookupKey: "starter_monthly",
      usage: 0,
      activeAccountCount: 3,
      blockCode: "page_limit_exceeded",
    },
  ])("fails closed for $name", (input) => {
    expect(evaluateEntitlement({ ...period, ...input }).blockCode).toBe(
      input.blockCode
    )
  })

  it("does not reuse an expired billing period", () => {
    expect(
      evaluateEntitlement({
        ...period,
        currentPeriodEnd: new Date("2026-07-28T00:00:00.000Z"),
        priceLookupKey: "pro_monthly",
        usage: 0,
        activeAccountCount: 0,
      }).blockCode
    ).toBe("plan_unavailable")
  })

  it("preserves specific public page and plan error codes", () => {
    expect(entitlementHttpError("page_limit_exceeded").status).toBe(403)
    expect(entitlementHttpError("plan_unavailable").message).toContain(
      "info@resender.dev"
    )
  })
})
