import { readFile } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return {
    ...original,
    createCheckoutSession: mocks.createCheckoutSession,
    createBillingPortalSession: mocks.createBillingPortalSession,
  }
})

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { openPortal, startCheckout } from "./actions"

const ACTOR_ID = "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
const REDIRECT = new Error("NEXT_REDIRECT")

describe("Billing Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("APP_URL", "https://resender.dev")
    mocks.auth.mockResolvedValue({ user: { id: ACTOR_ID } })
    mocks.redirect.mockImplementation(() => {
      throw REDIRECT
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("authenticates Checkout and Portal independently", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(startCheckout("starter_monthly")).rejects.toBe(REDIRECT)
    await expect(openPortal()).rejects.toBe(REDIRECT)

    expect(mocks.auth).toHaveBeenCalledTimes(2)
    expect(mocks.redirect).toHaveBeenNthCalledWith(1, "/login")
    expect(mocks.redirect).toHaveBeenNthCalledWith(2, "/login")
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled()
    expect(mocks.createBillingPortalSession).not.toHaveBeenCalled()
  })

  it("rejects an unknown plan after authentication and before RPC", async () => {
    await expect(startCheckout("attacker_price")).rejects.toBe(REDIRECT)

    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.redirect).toHaveBeenCalledWith("/billing")
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled()
  })

  it("passes the exact actor, allowlisted plan, and configured origin then redirects outside the RPC catch", async () => {
    mocks.createCheckoutSession.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/session-token",
    })

    await expect(startCheckout("starter_monthly")).rejects.toBe(REDIRECT)

    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      {
        priceLookupKey: "starter_monthly",
        origin: "https://resender.dev",
      }
    )
    expect(mocks.redirect).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay/session-token"
    )
  })

  it("passes only the actor and configured origin to Customer Portal", async () => {
    mocks.createBillingPortalSession.mockResolvedValue({
      url: "https://billing.stripe.com/p/session/portal-token",
    })

    await expect(openPortal()).rejects.toBe(REDIRECT)

    expect(mocks.createBillingPortalSession).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { origin: "https://resender.dev" }
    )
    expect(mocks.redirect).toHaveBeenCalledWith(
      "https://billing.stripe.com/p/session/portal-token"
    )
  })

  it.each([
    [
      "waitlisted Checkout",
      "checkout",
      accessError("account_waitlisted"),
      "/waitlist",
    ],
    [
      "deleted Checkout actor",
      "checkout",
      rpcError("not_found", "not_found", 404),
      "/waitlist",
    ],
    [
      "unknown backend plan",
      "checkout",
      rpcError("plan_unavailable", "entitlement", 403),
      "/billing",
    ],
    [
      "waitlisted Portal",
      "portal",
      accessError("account_waitlisted"),
      "/waitlist",
    ],
    [
      "unsubscribed Portal",
      "portal",
      accessError("subscription_required"),
      "/billing",
    ],
    [
      "Portal without customer",
      "portal",
      rpcError("not_found", "not_found", 404),
      "/billing",
    ],
  ] as const)(
    "maps %s races to a safe redirect",
    async (_name, surface, error, destination) => {
      if (surface === "checkout") {
        mocks.createCheckoutSession.mockRejectedValue(error)
        await expect(startCheckout("starter_monthly")).rejects.toBe(REDIRECT)
      } else {
        mocks.createBillingPortalSession.mockRejectedValue(error)
        await expect(openPortal()).rejects.toBe(REDIRECT)
      }

      expect(mocks.redirect).toHaveBeenLastCalledWith(destination)
    }
  )

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("provider_unavailable", "transient", 502),
    rpcError("internal_error", "internal", 500),
  ])("hard-fails sanitized backend and Stripe errors", async (error) => {
    mocks.createCheckoutSession.mockRejectedValue(error)

    await expect(startCheckout("starter_monthly")).rejects.toBe(error)
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(JSON.stringify(error)).not.toMatch(/sk_|rk_|cus_|sub_/u)
  })

  it.each([
    ["missing", undefined],
    ["path", "https://resender.dev/attacker"],
    ["credentials", "https://user:password@resender.dev"],
  ])("fails closed for %s APP_URL configuration", async (_name, appUrl) => {
    if (appUrl === undefined) {
      vi.stubEnv("APP_URL", "")
    } else {
      vi.stubEnv("APP_URL", appUrl)
    }

    await expect(startCheckout("starter_monthly")).rejects.toThrow(/APP_URL/u)
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("does not read Host headers or log, persist, analyze, or cookie Stripe redirect URLs", async () => {
    const source = await readFile(
      new URL("./actions.ts", import.meta.url),
      "utf8"
    )

    expect(source).not.toMatch(
      /headers\(|x-forwarded-host|x-forwarded-proto|cookies\(|console\.|posthog|localStorage|sessionStorage/u
    )
    expect(source).not.toMatch(/payment_method_types/u)
  })
})

function accessError(
  code: "account_waitlisted" | "subscription_required"
): BackendRpcError {
  return rpcError(code, "access", 403)
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "plan_unavailable"
    | "not_found"
    | "provider_unavailable"
    | "internal_error",
  kind: "access" | "entitlement" | "not_found" | "transient" | "internal",
  status: 403 | 404 | 500 | 502
): BackendRpcError {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: kind === "transient",
  })
}
