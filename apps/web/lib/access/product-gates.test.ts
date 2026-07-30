import { describe, expect, it } from "vitest"

import type {
  ProductAccessDto,
  ProductShellDto,
} from "@workspace/contracts"

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"
import {
  billingPageRedirect,
  productPageRedirect,
  productShellFailureDecision,
  productShellNotice,
  waitlistPageRedirect,
} from "./product-gates"

const states = [
  {
    name: "deleted session",
    access: access({
      userExists: false,
      destination: "waitlist",
    }),
    product: "/waitlist",
    billing: "/waitlist",
    waitlist: null,
  },
  {
    name: "waitlisted",
    access: access({ waitlisted: true, destination: "waitlist" }),
    product: "/waitlist",
    billing: "/waitlist",
    waitlist: null,
  },
  {
    name: "inactive subscription",
    access: access({ destination: "billing" }),
    product: "/billing",
    billing: null,
    waitlist: "/connections",
  },
  {
    name: "active subscription",
    access: access({
      subscriptionActive: true,
      destination: "product",
    }),
    product: null,
    billing: "/connections",
    waitlist: "/connections",
  },
] as const

describe("product consumer gates", () => {
  it.each(states)("preserves redirects for $name", (state) => {
    expect(productPageRedirect(state.access)).toBe(state.product)
    expect(billingPageRedirect(state.access)).toBe(state.billing)
    expect(waitlistPageRedirect(state.access)).toBe(state.waitlist)
  })

  it("uses only the backend-owned notice decision", () => {
    expect(productShellNotice(shell())).toBeNull()
    expect(
      productShellNotice(shell({ usage: 40_000, noticeLevel: "warning" }))
    ).toMatchObject({ level: "warning", usage: 40_000 })
  })

  it("supports an old blocked DTO without recomputing warning thresholds", () => {
    expect(
      productShellNotice(
        shell({
          usage: 50_000,
          blockCode: "quota_exceeded",
        })
      )
    ).toMatchObject({
      level: "restricted",
      blockCode: "quota_exceeded",
      usage: 50_000,
    })
    expect(productShellNotice(shell({ usage: 49_999 }))).toBeNull()
  })

  it.each([
    ["account_waitlisted", "/waitlist"],
    ["not_found", "/waitlist"],
    ["subscription_required", "/billing"],
  ] as const)("redirects a shell access race for %s", (code, destination) => {
    const status = code === "not_found" ? 404 : 403
    const kind = code === "not_found" ? "not_found" : "access"

    expect(
      productShellFailureDecision(
        new BackendRpcError({
          kind,
          code,
          status,
          retryable: false,
          ...(code === "account_waitlisted"
            ? { destination: "/waitlist" as const }
            : code === "subscription_required"
              ? { destination: "/billing" as const }
              : {}),
        })
      )
    ).toEqual({ kind: "redirect", destination })
  })

  it("omits only operational notice failures with sanitized logs", () => {
    expect(
      productShellFailureDecision(
        new BackendRpcError({
          kind: "transient",
          code: "provider_unavailable",
          status: 502,
          retryable: true,
        })
      )
    ).toEqual({
      kind: "omit_notice",
      log: {
        kind: "transient",
        code: "provider_unavailable",
        status: 502,
        retryable: true,
      },
    })
    expect(
      productShellFailureDecision(new BackendUnavailableError())
    ).toEqual({
      kind: "omit_notice",
      log: {
        kind: "unavailable",
        code: null,
        status: null,
        retryable: true,
      },
    })
    expect(
      productShellFailureDecision(
        new BackendRpcError({
          kind: "provider",
          code: "provider_rejected",
          status: 422,
          retryable: false,
        })
      )
    ).toEqual({
      kind: "omit_notice",
      log: {
        kind: "provider",
        code: "provider_rejected",
        status: 422,
        retryable: false,
      },
    })
  })

  it("keeps protocol failures hard", () => {
    expect(
      productShellFailureDecision(new BackendProtocolError())
    ).toEqual({ kind: "throw" })
  })
})

function access(
  overrides: Partial<ProductAccessDto>
): ProductAccessDto {
  return {
    userExists: true,
    waitlisted: false,
    subscriptionActive: false,
    destination: "billing",
    ...overrides,
  }
}

function shell(
  overrides: Partial<ProductShellDto["entitlement"]> = {}
): ProductShellDto {
  return {
    tenantId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    email: "person@example.com",
    entitlement: {
      priceLookupKey: "starter_monthly",
      usage: 1,
      messageLimit: 50_000,
      activePageCount: 1,
      pageLimit: 2,
      blockCode: null,
      ...overrides,
    },
  }
}
