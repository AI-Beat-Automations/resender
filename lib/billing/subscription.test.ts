import { describe, expect, it } from "vitest"

import {
  findSupersededSubscriptionId,
  hasActiveStatus,
  resolveCancelAtPeriodEnd,
  resolveSubscriptionPeriod,
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

const T0 = new Date("2026-07-10T00:00:00Z")
const T1 = new Date("2026-07-10T00:01:00Z")
const T2 = new Date("2026-07-10T00:02:00Z")

function record(
  overrides: Partial<SubscriptionRecord> = {}
): SubscriptionRecord {
  return {
    tenantId: "tenant-1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    lastStripeEventAt: T1,
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
    currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    lastStripeEventAt: T1,
    ...overrides,
  }
}

describe("subscription upsert decision", () => {
  it("applies the first event for a tenant without a row", () => {
    expect(shouldApplySubscriptionEvent(null, incoming())).toBe(true)
  })

  it("applies any event over a row without an event mark (pre-migration)", () => {
    const unmarked = record({ lastStripeEventAt: null })
    expect(
      shouldApplySubscriptionEvent(
        unmarked,
        incoming({ lastStripeEventAt: T0 })
      )
    ).toBe(true)
  })

  it("is idempotent for a repeated event", () => {
    expect(shouldApplySubscriptionEvent(record(), incoming())).toBe(true)
  })

  it("applies newer events of the same subscription", () => {
    const renewed = incoming({
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      lastStripeEventAt: T2,
    })
    expect(shouldApplySubscriptionEvent(record(), renewed)).toBe(true)
  })

  it("skips a stale event of the same subscription, even within the same period", () => {
    // active(T1) ya aplicado; llega rezagado el past_due(T0) del mismo período
    const stale = incoming({ status: "past_due", lastStripeEventAt: T0 })
    expect(shouldApplySubscriptionEvent(record(), stale)).toBe(false)
  })

  it("skips a stale reactivation arriving after a deletion", () => {
    const deleted = record({ status: "canceled", lastStripeEventAt: T2 })
    const staleActive = incoming({ status: "active", lastStripeEventAt: T1 })
    expect(shouldApplySubscriptionEvent(deleted, staleActive)).toBe(false)
  })

  it("skips a late deletion of a previous subscription", () => {
    const current = record({ stripeSubscriptionId: "sub_2" })
    const lateDeletion = incoming({
      stripeSubscriptionId: "sub_1",
      status: "canceled",
      lastStripeEventAt: T2,
    })
    expect(shouldApplySubscriptionEvent(current, lateDeletion)).toBe(false)
  })

  it("skips a stale creation of a previous subscription", () => {
    const current = record({
      stripeSubscriptionId: "sub_2",
      lastStripeEventAt: T2,
    })
    const staleCreation = incoming({
      stripeSubscriptionId: "sub_1",
      lastStripeEventAt: T1,
    })
    expect(shouldApplySubscriptionEvent(current, staleCreation)).toBe(false)
  })

  it("replaces a dead subscription when the tenant subscribes again", () => {
    const canceled = record({ status: "canceled" })
    const resubscribed = incoming({
      stripeSubscriptionId: "sub_2",
      lastStripeEventAt: T2,
    })
    expect(shouldApplySubscriptionEvent(canceled, resubscribed)).toBe(true)
  })
})

describe("superseded subscription detection", () => {
  it("returns null without an existing row or for the same subscription", () => {
    expect(findSupersededSubscriptionId(null, incoming())).toBe(null)
    expect(findSupersededSubscriptionId(record(), incoming())).toBe(null)
  })

  it("cancels the stored subscription when a newer live one arrives", () => {
    const duplicate = incoming({
      stripeSubscriptionId: "sub_2",
      lastStripeEventAt: T2,
    })
    expect(findSupersededSubscriptionId(record(), duplicate)).toBe("sub_1")
  })

  it("cancels the incoming subscription when its event lost the race", () => {
    const current = record({
      stripeSubscriptionId: "sub_2",
      lastStripeEventAt: T2,
    })
    const lateDuplicate = incoming({
      stripeSubscriptionId: "sub_1",
      lastStripeEventAt: T1,
    })
    expect(findSupersededSubscriptionId(current, lateDuplicate)).toBe("sub_1")
  })

  it("ignores pairs where either subscription is already dead", () => {
    const canceled = record({ status: "canceled" })
    const resubscribed = incoming({
      stripeSubscriptionId: "sub_2",
      lastStripeEventAt: T2,
    })
    expect(findSupersededSubscriptionId(canceled, resubscribed)).toBe(null)

    const current = record({ stripeSubscriptionId: "sub_2" })
    const lateDeletion = incoming({
      stripeSubscriptionId: "sub_1",
      status: "canceled",
      lastStripeEventAt: T2,
    })
    expect(findSupersededSubscriptionId(current, lateDeletion)).toBe(null)
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

describe("billing period resolution", () => {
  const start = 1_784_678_928
  const end = 1_787_357_328

  it("reads the period from the subscription item", () => {
    expect(
      resolveSubscriptionPeriod({
        items: {
          data: [{ current_period_start: start, current_period_end: end }],
        },
      })
    ).toEqual({
      currentPeriodStart: new Date(start * 1000),
      currentPeriodEnd: new Date(end * 1000),
    })
  })

  // Un webhook endpoint pinneado antes de 2025-03-31.basil entrega el período
  // en la raíz; sin este fallback la cuota se queda sin ventana.
  it("falls back to the root fields of pre-basil payloads", () => {
    expect(
      resolveSubscriptionPeriod({
        current_period_start: start,
        current_period_end: end,
        items: { data: [{}] },
      })
    ).toEqual({
      currentPeriodStart: new Date(start * 1000),
      currentPeriodEnd: new Date(end * 1000),
    })
  })

  it("prefers the item over the root when both are present", () => {
    expect(
      resolveSubscriptionPeriod({
        current_period_start: 1,
        current_period_end: 2,
        items: {
          data: [{ current_period_start: start, current_period_end: end }],
        },
      })
    ).toEqual({
      currentPeriodStart: new Date(start * 1000),
      currentPeriodEnd: new Date(end * 1000),
    })
  })

  it("returns nulls when neither shape carries the period", () => {
    expect(resolveSubscriptionPeriod({ items: { data: [] } })).toEqual({
      currentPeriodStart: null,
      currentPeriodEnd: null,
    })
  })
})

describe("scheduled cancellation resolution", () => {
  // Forma vieja de la API: el booleano marcado.
  it("detects the legacy cancel_at_period_end flag", () => {
    expect(resolveCancelAtPeriodEnd({ cancel_at_period_end: true })).toBe(true)
  })

  // Forma de 2026-07-29.dahlia, tal como llegó en el evento real
  // evt_1TzST5K73vMS5LDKRINvV7kd al cancelar desde el Customer Portal: el
  // booleano se queda en false y la baja vive en cancel_at.
  it("detects a cancellation expressed only as cancel_at", () => {
    expect(
      resolveCancelAtPeriodEnd({
        cancel_at: 1_788_228_588,
        cancel_at_period_end: false,
      })
    ).toBe(true)
  })

  it("reports no cancellation for a subscription that just renews", () => {
    expect(
      resolveCancelAtPeriodEnd({ cancel_at: null, cancel_at_period_end: false })
    ).toBe(false)
    expect(resolveCancelAtPeriodEnd({})).toBe(false)
  })
})
