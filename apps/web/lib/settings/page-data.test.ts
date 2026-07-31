import { describe, expect, it, vi } from "vitest"
import type {
  ApiKeyDto,
  BillingStateDto,
  ProductShellDto,
} from "@workspace/contracts"

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import {
  loadSettingsAccount,
  loadSettingsApiKeys,
  loadSettingsBilling,
} from "./page-data"

const ACTOR = { userId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15" }

describe("Settings page data", () => {
  it("loads account identity from the tenant-checked shell RPC", async () => {
    const dependencies = dependenciesWith()

    await expect(loadSettingsAccount(ACTOR, dependencies)).resolves.toEqual({
      kind: "ready",
      data: {
        tenantId: ACTOR.userId,
        email: "person@example.com",
      },
    })
    expect(dependencies.getProductShell).toHaveBeenCalledWith(ACTOR)
    expect(dependencies.listApiKeys).not.toHaveBeenCalled()
    expect(dependencies.getBillingState).not.toHaveBeenCalled()
  })

  it("loads active and revoked API key history without fetching account shell", async () => {
    const dependencies = dependenciesWith({
      apiKeys: [
        apiKey(),
        apiKey({
          id: "61c94a3a-c22f-47f8-ab1f-b797307cea32",
          status: "revoked",
          revokedAt: "2026-07-30T19:00:00.000Z",
        }),
      ],
    })

    const result = await loadSettingsApiKeys(ACTOR, dependencies)

    expect(result).toMatchObject({
      kind: "ready",
      data: [
        { status: "active", revokedAt: null },
        { status: "revoked", revokedAt: "2026-07-30T19:00:00.000Z" },
      ],
    })
    expect(dependencies.listApiKeys).toHaveBeenCalledWith(ACTOR)
    expect(dependencies.getProductShell).not.toHaveBeenCalled()
    expect(dependencies.getBillingState).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(
      /secretHash|pepper|tenantId|pk_live_[A-Za-z0-9_-]{20}/u
    )
  })

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("not_found", "not_found", 404), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)(
    "maps account access races to redirects",
    async (error, destination) => {
      const dependencies = dependenciesWith()
      dependencies.getProductShell.mockRejectedValue(error)

      await expect(loadSettingsAccount(ACTOR, dependencies)).resolves.toEqual({
        kind: "redirect",
        destination,
      })
    }
  )

  it.each([null, "past_due", "canceled"] as const)(
    "redirects a subscription-tab race with status %s",
    async (status) => {
      const dependencies = dependenciesWith()
      dependencies.getBillingState.mockResolvedValue({
        ...billingState(),
        subscription:
          status === null ? null : { ...billingState().subscription!, status },
      })

      await expect(loadSettingsBilling(ACTOR, dependencies)).resolves.toEqual({
        kind: "redirect",
        destination: "/billing",
      })
    }
  )

  it("loads only the safe billing DTO for the subscription tab", async () => {
    const dependencies = dependenciesWith()

    const result = await loadSettingsBilling(ACTOR, dependencies)

    expect(result).toEqual({
      kind: "ready",
      data: billingState(),
    })
    expect(dependencies.getBillingState).toHaveBeenCalledWith(ACTOR)
    expect(dependencies.getProductShell).not.toHaveBeenCalled()
    expect(dependencies.listApiKeys).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(
      /cus_|sub_|stripeCustomerId|stripeSubscriptionId/u
    )
  })

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("not_found", "not_found", 404), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)(
    "maps billing access races to redirects",
    async (error, destination) => {
      const dependencies = dependenciesWith()
      dependencies.getBillingState.mockRejectedValue(error)

      await expect(loadSettingsBilling(ACTOR, dependencies)).resolves.toEqual({
        kind: "redirect",
        destination,
      })
    }
  )

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("not_found", "not_found", 404), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)(
    "maps API key access races to redirects",
    async (error, destination) => {
      const dependencies = dependenciesWith()
      dependencies.listApiKeys.mockRejectedValue(error)

      await expect(loadSettingsApiKeys(ACTOR, dependencies)).resolves.toEqual({
        kind: "redirect",
        destination,
      })
    }
  )

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("internal_error", "internal", 500),
    rpcError("provider_unavailable", "transient", 502),
  ])("fails closed for backend and protocol failures", async (error) => {
    const accountDependencies = dependenciesWith()
    accountDependencies.getProductShell.mockRejectedValue(error)
    const keyDependencies = dependenciesWith()
    keyDependencies.listApiKeys.mockRejectedValue(error)
    const billingDependencies = dependenciesWith()
    billingDependencies.getBillingState.mockRejectedValue(error)

    await expect(loadSettingsAccount(ACTOR, accountDependencies)).rejects.toBe(
      error
    )
    await expect(loadSettingsApiKeys(ACTOR, keyDependencies)).rejects.toBe(
      error
    )
    await expect(loadSettingsBilling(ACTOR, billingDependencies)).rejects.toBe(
      error
    )
  })
})

function dependenciesWith(input: { apiKeys?: ApiKeyDto[] } = {}) {
  return {
    getProductShell: vi.fn(async () => shell()),
    listApiKeys: vi.fn(async () => input.apiKeys ?? [apiKey()]),
    getBillingState: vi.fn(async () => billingState()),
  }
}

function billingState(): BillingStateDto {
  return {
    subscription: {
      status: "active",
      priceLookupKey: "starter_monthly",
      currentPeriodStart: "2026-07-01T00:00:00.000Z",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    },
    entitlement: {
      priceLookupKey: "starter_monthly",
      usage: 10,
      messageLimit: 50_000,
      activePageCount: 1,
      pageLimit: 2,
      blockCode: null,
      noticeLevel: null,
    },
  }
}

function shell(): ProductShellDto {
  return {
    tenantId: ACTOR.userId,
    email: "person@example.com",
    entitlement: {
      priceLookupKey: "starter_monthly",
      usage: 1,
      messageLimit: 50_000,
      activePageCount: 1,
      pageLimit: 3,
      blockCode: null,
      noticeLevel: null,
    },
  }
}

function apiKey(overrides: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: "61c94a3a-c22f-47f8-ab1f-b797307cea31",
    label: "Production",
    visiblePrefix: "pk_live_aaaaaaaa",
    status: "active",
    createdAt: "2026-07-30T18:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "not_found"
    | "internal_error"
    | "provider_unavailable",
  kind: "access" | "not_found" | "internal" | "transient",
  status: 403 | 404 | 500 | 502
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: kind === "transient",
  })
}
