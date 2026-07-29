import { describe, expect, it } from "vitest"

import type {
  SubscriptionRecord,
  SubscriptionUpsertInput,
} from "../infrastructure/db/repository"
import {
  findSupersededSubscriptionId,
  shouldApplySubscriptionEvent,
} from "./subscriptions"

const OLD = new Date("2026-07-28T00:00:00.000Z")
const NEW = new Date("2026-07-29T00:00:00.000Z")

describe("Stripe subscription event ordering", () => {
  it.each(["canceled", "incomplete_expired"])(
    "never applies a newer %s event from another subscription",
    (status) => {
      const incoming = input({ stripeSubscriptionId: "sub_old", status })
      expect(shouldApplySubscriptionEvent(existing(), incoming)).toBe(false)
      expect(findSupersededSubscriptionId(existing(), incoming)).toBeNull()
    }
  )

  it("ignores an older snapshot of the same subscription", () => {
    const incoming = input({
      stripeSubscriptionId: "sub_current",
      eventAt: OLD,
    })
    expect(shouldApplySubscriptionEvent(existing(), incoming)).toBe(false)
    expect(findSupersededSubscriptionId(existing(), incoming)).toBeNull()
  })

  it("applies a newer terminal snapshot of the same subscription", () => {
    const incoming = input({
      stripeSubscriptionId: "sub_current",
      status: "canceled",
    })
    expect(shouldApplySubscriptionEvent(existing(), incoming)).toBe(true)
    expect(findSupersededSubscriptionId(existing(), incoming)).toBeNull()
  })

  it("replaces a live subscription with a newer live subscription", () => {
    const incoming = input({ stripeSubscriptionId: "sub_new" })
    expect(shouldApplySubscriptionEvent(existing(), incoming)).toBe(true)
    expect(findSupersededSubscriptionId(existing(), incoming)).toBe(
      "sub_current"
    )
  })

  it("keeps the newer live subscription and cleans up an older live duplicate", () => {
    const incoming = input({
      stripeSubscriptionId: "sub_old",
      eventAt: OLD,
    })
    expect(shouldApplySubscriptionEvent(existing(), incoming)).toBe(false)
    expect(findSupersededSubscriptionId(existing(), incoming)).toBe("sub_old")
  })
})

function existing(): SubscriptionRecord {
  return {
    tenantId: "tenant_1",
    stripeSubscriptionId: "sub_current",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: OLD,
    currentPeriodEnd: NEW,
    cancelAtPeriodEnd: false,
    lastStripeEventAt: new Date("2026-07-28T12:00:00.000Z"),
  }
}

function input(
  overrides: Partial<SubscriptionUpsertInput> = {}
): SubscriptionUpsertInput {
  return {
    tenantId: "tenant_1",
    stripeSubscriptionId: "sub_current",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: OLD,
    currentPeriodEnd: NEW,
    cancelAtPeriodEnd: false,
    eventAt: NEW,
    ...overrides,
  }
}
