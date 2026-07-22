import { describe, expect, it } from "vitest"

import {
  hasActiveStatus,
  resolveTenantId,
  shouldApplySubscriptionEvent,
  type SubscriptionRecord,
  type SubscriptionUpsertInput,
} from "./subscription"

describe("subscription access predicate", () => {
  it("grants access only for the active status", () => {
    expect(hasActiveStatus({ status: "active" })).toBe(true)
  })

  it.each([
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
    "trialing",
  ])("blocks the %s status", (status) => {
    expect(hasActiveStatus({ status })).toBe(false)
  })

  it("fails closed when the subscription row is missing", () => {
    expect(hasActiveStatus(null)).toBe(false)
    expect(hasActiveStatus(undefined)).toBe(false)
  })
})

function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    tenantId: "tenant-1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

function incoming(
  overrides: Partial<SubscriptionUpsertInput> = {}
): SubscriptionUpsertInput {
  return {
    tenantId: "tenant-1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

describe("subscription upsert decision", () => {
  it("applies the first event for a tenant without a row", () => {
    expect(shouldApplySubscriptionEvent(null, incoming())).toBe(true)
  })

  it("is idempotent for a repeated event", () => {
    expect(shouldApplySubscriptionEvent(record(), incoming())).toBe(true)
  })

  it("applies newer snapshots of the same subscription", () => {
    const renewed = incoming({
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    })
    expect(shouldApplySubscriptionEvent(record(), renewed)).toBe(true)
  })

  it("skips a stale event of the same subscription from a previous period", () => {
    const stale = incoming({
      status: "past_due",
      currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
    })
    expect(shouldApplySubscriptionEvent(record(), stale)).toBe(false)
  })

  it("skips a late deletion of a previous subscription", () => {
    const current = record({ stripeSubscriptionId: "sub_2" })
    const lateDeletion = incoming({
      stripeSubscriptionId: "sub_1",
      status: "canceled",
    })
    expect(shouldApplySubscriptionEvent(current, lateDeletion)).toBe(false)
  })

  it("replaces a dead subscription when the tenant subscribes again", () => {
    const canceled = record({ status: "canceled" })
    const resubscribed = incoming({ stripeSubscriptionId: "sub_2" })
    expect(shouldApplySubscriptionEvent(canceled, resubscribed)).toBe(true)
  })
})

describe("tenant resolution", () => {
  it("prefers the tenant id from metadata", () => {
    expect(
      resolveTenantId({
        metadataTenantId: "tenant-meta",
        customerTenantId: "tenant-customer",
      })
    ).toBe("tenant-meta")
  })

  it("falls back to the stripe customer mapping", () => {
    expect(
      resolveTenantId({
        metadataTenantId: null,
        customerTenantId: "tenant-customer",
      })
    ).toBe("tenant-customer")
    expect(
      resolveTenantId({
        metadataTenantId: "  ",
        customerTenantId: "tenant-customer",
      })
    ).toBe("tenant-customer")
  })

  it("returns null when neither source resolves", () => {
    expect(
      resolveTenantId({ metadataTenantId: undefined, customerTenantId: null })
    ).toBe(null)
  })
})
