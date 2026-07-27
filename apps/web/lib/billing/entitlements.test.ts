import { describe, expect, it } from "vitest"

import {
  countsTowardQuota,
  evaluateEntitlement,
  resolvePlanLimits,
  resolveQuotaNotice,
  resolveQuotaPeriodStart,
  shouldPushInbound,
  type EntitlementInput,
} from "./entitlements"

const NOW = new Date("2026-07-15T00:00:00Z")
const PERIOD_START = new Date("2026-07-01T00:00:00Z")
const PERIOD_END = new Date("2026-08-01T00:00:00Z")

function input(overrides: Partial<EntitlementInput> = {}): EntitlementInput {
  return {
    priceLookupKey: "starter_monthly",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    now: NOW,
    usage: 0,
    activePageCount: 1,
    ...overrides,
  }
}

describe("plan limits resolution", () => {
  it("resolves the limits of each plan by lookup key", () => {
    expect(resolvePlanLimits("starter_monthly")).toEqual({
      messagesPerPeriod: 50_000,
      maxPages: 2,
    })
    expect(resolvePlanLimits("pro_monthly")).toEqual({
      messagesPerPeriod: 100_000,
      maxPages: 5,
    })
  })

  it("fails closed for an unknown or missing lookup key", () => {
    expect(resolvePlanLimits("business_monthly")).toBe(null)
    expect(resolvePlanLimits(null)).toBe(null)
    expect(resolvePlanLimits(undefined)).toBe(null)
  })

  it("blocks with plan_unavailable when the lookup key is unknown", () => {
    const result = evaluateEntitlement(
      input({ priceLookupKey: "business_monthly" })
    )
    expect(result.limits).toBe(null)
    expect(result.block?.code).toBe("plan_unavailable")
    expect(result.block?.status).toBe(403)
    expect(result.notice.level).toBe("restricted")
  })
})

describe("quota period resolution", () => {
  it("returns the period start while the period is open", () => {
    expect(
      resolveQuotaPeriodStart({
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
        now: NOW,
      })
    ).toBe(PERIOD_START)
  })

  it("fails closed without a period start", () => {
    expect(
      resolveQuotaPeriodStart({
        currentPeriodStart: null,
        currentPeriodEnd: PERIOD_END,
        now: NOW,
      })
    ).toBe(null)
  })

  it("fails closed once the period is over", () => {
    expect(
      resolveQuotaPeriodStart({
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
        now: new Date("2026-08-02T00:00:00Z"),
      })
    ).toBe(null)
  })

  it("blocks when the subscription row has no period start", () => {
    const result = evaluateEntitlement(input({ currentPeriodStart: null }))
    expect(result.periodStart).toBe(null)
    expect(result.block?.code).toBe("plan_unavailable")
    expect(result.block?.status).toBe(403)
    expect(result.notice.level).toBe("restricted")
  })

  it("blocks when the stored period already expired", () => {
    const result = evaluateEntitlement(
      input({ now: new Date("2026-08-02T00:00:00Z") })
    )
    expect(result.periodStart).toBe(null)
    expect(result.block?.code).toBe("plan_unavailable")
  })

  it("keeps the period start on the happy path", () => {
    const result = evaluateEntitlement(input())
    expect(result.periodStart).toBe(PERIOD_START)
    expect(result.block).toBe(null)
  })
})

describe("send decision", () => {
  it("allows sending within the quota and the page limit", () => {
    const result = evaluateEntitlement(
      input({ usage: 49_999, activePageCount: 2 })
    )
    expect(result.block).toBe(null)
  })

  it("blocks with 402 quota_exceeded exactly at the limit", () => {
    const result = evaluateEntitlement(input({ usage: 50_000 }))
    expect(result.block?.code).toBe("quota_exceeded")
    expect(result.block?.status).toBe(402)
  })

  it("blocks with 402 quota_exceeded above the limit", () => {
    const result = evaluateEntitlement(input({ usage: 50_123 }))
    expect(result.block?.code).toBe("quota_exceeded")
    expect(result.block?.status).toBe(402)
  })

  it("blocks with 403 page_limit_exceeded above maxPages", () => {
    const result = evaluateEntitlement(input({ activePageCount: 3 }))
    expect(result.block?.code).toBe("page_limit_exceeded")
    expect(result.block?.status).toBe(403)
  })

  it("prefers the page limit when both restriction causes apply at once", () => {
    // Desconectar una página es gratis; subir de plan no. Mandar al usuario a
    // pagar cuando le basta con desconectar lo haría pagar de más.
    const result = evaluateEntitlement(
      input({ usage: 80_000, activePageCount: 4 })
    )
    expect(result.block?.code).toBe("page_limit_exceeded")
    expect(result.block?.status).toBe(403)
  })
})

describe("quota accounting", () => {
  it("counts a persisted inbound message", () => {
    expect(countsTowardQuota({ kind: "inbound", persisted: true })).toBe(true)
  })

  it("does not count an inbound message that was not persisted", () => {
    expect(countsTowardQuota({ kind: "inbound", persisted: false })).toBe(false)
  })

  it("counts a reply accepted by Meta", () => {
    expect(
      countsTowardQuota({
        kind: "reply",
        acceptedByMeta: true,
        idempotentReplay: false,
      })
    ).toBe(true)
  })

  it("does not count a reply rejected by Meta", () => {
    expect(
      countsTowardQuota({
        kind: "reply",
        acceptedByMeta: false,
        idempotentReplay: false,
      })
    ).toBe(false)
  })

  it("does not count an idempotent replay", () => {
    expect(
      countsTowardQuota({
        kind: "reply",
        acceptedByMeta: true,
        idempotentReplay: true,
      })
    ).toBe(false)
  })
})

describe("inbound push decision", () => {
  it("pushes inbound messages while the account is operational", () => {
    const entitlement = evaluateEntitlement(input())
    expect(shouldPushInbound(entitlement)).toBe(true)
    expect(countsTowardQuota({ kind: "inbound", persisted: true })).toBe(true)
  })

  it("stops pushing when the quota is exhausted, but still counts the inbound", () => {
    const entitlement = evaluateEntitlement(input({ usage: 50_000 }))
    expect(shouldPushInbound(entitlement)).toBe(false)
    expect(countsTowardQuota({ kind: "inbound", persisted: true })).toBe(true)
  })

  it("stops pushing with too many pages, but still counts the inbound", () => {
    const entitlement = evaluateEntitlement(input({ activePageCount: 3 }))
    expect(shouldPushInbound(entitlement)).toBe(false)
    expect(countsTowardQuota({ kind: "inbound", persisted: true })).toBe(true)
  })
})

describe("quota notice level", () => {
  it("stays silent below 80% of the plan quota", () => {
    expect(resolveQuotaNotice({ usage: 39_999, limit: 50_000 }).level).toBe(
      "none"
    )
  })

  it("warns exactly at 80%", () => {
    const notice = resolveQuotaNotice({ usage: 40_000, limit: 50_000 })
    expect(notice.level).toBe("warning")
    expect(notice.ratio).toBe(0.8)
  })

  it("reports restricted at and above 100%", () => {
    expect(resolveQuotaNotice({ usage: 50_000, limit: 50_000 }).level).toBe(
      "restricted"
    )
    expect(resolveQuotaNotice({ usage: 60_000, limit: 50_000 }).level).toBe(
      "restricted"
    )
  })
})

describe("plan change", () => {
  it("keeps the usage and applies the new ceiling immediately on upgrade", () => {
    const exhausted = evaluateEntitlement(input({ usage: 50_000 }))
    expect(exhausted.block?.code).toBe("quota_exceeded")

    const upgraded = evaluateEntitlement(
      input({ usage: 50_000, priceLookupKey: "pro_monthly" })
    )
    expect(upgraded.usage).toBe(exhausted.usage)
    expect(upgraded.limits?.messagesPerPeriod).toBe(100_000)
    expect(upgraded.block).toBe(null)
  })
})
