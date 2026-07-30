import { describe, expect, it, vi } from "vitest"
import type {
  BillingStateDto,
  CheckoutVerificationDto,
} from "@workspace/contracts"

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { loadBillingSuccess } from "./page-data"

const ACTOR = { userId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15" }

describe("Billing success page data", () => {
  it("redirects an already activated webhook state without reading Checkout", async () => {
    const dependencies = dependenciesWith({
      billing: billingState({ status: "active" }),
    })

    await expect(
      loadBillingSuccess(ACTOR, "cs_test_1234567890abcdef", dependencies)
    ).resolves.toEqual({
      kind: "redirect",
      destination: "/connections",
    })
    expect(dependencies.getBillingState).toHaveBeenCalledWith(ACTOR)
    expect(dependencies.verifyCheckoutSession).not.toHaveBeenCalled()
  })

  it("renders activation only for an owned complete Checkout while webhook state is pending", async () => {
    const dependencies = dependenciesWith({ complete: true })

    await expect(
      loadBillingSuccess(ACTOR, "cs_live_1234567890abcdef", dependencies)
    ).resolves.toEqual({ kind: "ready" })
    expect(dependencies.verifyCheckoutSession).toHaveBeenCalledWith(ACTOR, {
      sessionId: "cs_live_1234567890abcdef",
    })
    expect(
      dependencies.getBillingState.mock.invocationCallOrder[0]
    ).toBeLessThan(
      dependencies.verifyCheckoutSession.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY
    )
  })

  it.each([false, true] as const)(
    "does not grant access from Checkout verification complete=%s",
    async (complete) => {
      const dependencies = dependenciesWith({ complete })

      const result = await loadBillingSuccess(
        ACTOR,
        "cs_test_1234567890abcdef",
        dependencies
      )

      expect(result).toEqual(
        complete
          ? { kind: "ready" }
          : { kind: "redirect", destination: "/billing" }
      )
      expect(result).not.toHaveProperty("subscriptionActive")
      expect(dependencies.getBillingState).toHaveBeenCalledOnce()
    }
  )

  it.each([
    undefined,
    "",
    "cs_test_short",
    "cs_fake_1234567890abcdef",
    "cs_live_1234<script>567890",
  ])(
    "rejects invalid Checkout session %s before verification RPC",
    async (id) => {
      const dependencies = dependenciesWith()

      await expect(
        loadBillingSuccess(ACTOR, id, dependencies)
      ).resolves.toEqual({
        kind: "redirect",
        destination: "/billing",
      })
      expect(dependencies.verifyCheckoutSession).not.toHaveBeenCalled()
    }
  )

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)("maps access race to %s", async (error, destination) => {
    const dependencies = dependenciesWith()
    dependencies.getBillingState.mockRejectedValue(error)

    await expect(
      loadBillingSuccess(ACTOR, "cs_test_1234567890abcdef", dependencies)
    ).resolves.toEqual({ kind: "redirect", destination })
    expect(dependencies.verifyCheckoutSession).not.toHaveBeenCalled()
  })

  it.each([
    rpcError("not_found", "not_found", 404),
    rpcError("validation_error", "validation", 400),
  ])("hides foreign or invalid Checkout sessions", async (error) => {
    const dependencies = dependenciesWith()
    dependencies.verifyCheckoutSession.mockRejectedValue(error)

    await expect(
      loadBillingSuccess(ACTOR, "cs_test_1234567890abcdef", dependencies)
    ).resolves.toEqual({ kind: "redirect", destination: "/billing" })
  })

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("provider_unavailable", "transient", 502),
    rpcError("internal_error", "internal", 500),
  ])(
    "hard-fails operational verification errors without exposing the id",
    async (error) => {
      const dependencies = dependenciesWith()
      dependencies.verifyCheckoutSession.mockRejectedValue(error)

      await expect(
        loadBillingSuccess(ACTOR, "cs_test_1234567890abcdef", dependencies)
      ).rejects.toBe(error)
      expect(JSON.stringify(error)).not.toMatch(/cs_test_|cus_|sub_/u)
    }
  )
})

function dependenciesWith(
  input: {
    billing?: BillingStateDto
    complete?: boolean
  } = {}
) {
  return {
    getBillingState: vi.fn(async () =>
      Promise.resolve(input.billing ?? billingState())
    ),
    verifyCheckoutSession: vi.fn(
      async (): Promise<CheckoutVerificationDto> => ({
        complete: input.complete ?? false,
      })
    ),
  }
}

function billingState(
  subscription: { status: string } | null = null
): BillingStateDto {
  return {
    subscription: subscription
      ? {
          status: subscription.status,
          priceLookupKey: "starter_monthly",
          currentPeriodStart: "2026-07-01T00:00:00.000Z",
          currentPeriodEnd: "2026-08-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
        }
      : null,
    entitlement: {
      priceLookupKey: subscription ? "starter_monthly" : null,
      usage: 0,
      messageLimit: subscription ? 50_000 : null,
      activePageCount: 0,
      pageLimit: subscription ? 2 : null,
      blockCode: subscription ? null : "plan_unavailable",
      noticeLevel: subscription ? null : "blocked",
    },
  }
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "not_found"
    | "validation_error"
    | "provider_unavailable"
    | "internal_error",
  kind: "access" | "not_found" | "validation" | "transient" | "internal",
  status: 400 | 403 | 404 | 500 | 502
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: kind === "transient",
  })
}
