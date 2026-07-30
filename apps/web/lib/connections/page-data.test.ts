import { describe, expect, it, vi } from "vitest"
import type { ProductShellDto, RpcPageDto } from "@workspace/contracts"

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { loadConnectionsPageData, toConnectedPageView } from "./page-data"

const ACTOR = { userId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15" }

describe("Connections Page data", () => {
  it("orders active valid, active invalid, then disconnected Pages", async () => {
    const dependencies = dependenciesWith([
      page({
        id: "f251bd5a-2772-489a-a725-43e2ea9d44e3",
        status: "disconnected",
        disconnectedAt: "2026-07-29T18:04:00.000Z",
      }),
      page({
        id: "f251bd5a-2772-489a-a725-43e2ea9d44e2",
        tokenStatus: "invalid",
        tokenError: "access_token=SECRET raw provider body",
        tokenErrorAt: "2026-07-29T18:02:00.000Z",
      }),
      page({ id: "f251bd5a-2772-489a-a725-43e2ea9d44e1" }),
    ])

    const result = await loadConnectionsPageData(ACTOR, dependencies)

    expect(dependencies.listPages).toHaveBeenCalledWith(ACTOR)
    expect(dependencies.getProductShell).toHaveBeenCalledWith(ACTOR)
    expect(result).toMatchObject({
      kind: "ready",
      data: {
        pages: [
          { id: "f251bd5a-2772-489a-a725-43e2ea9d44e1" },
          {
            id: "f251bd5a-2772-489a-a725-43e2ea9d44e2",
            tokenErrorAt: "2026-07-29T18:02:00.000Z",
            tokenErrorLabel: "Meta rechazó la credencial de esta página.",
          },
          {
            id: "f251bd5a-2772-489a-a725-43e2ea9d44e3",
            disconnectedAt: "2026-07-29T18:04:00.000Z",
          },
        ],
        quota: { activePageCount: 2, maxPages: 3 },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(
      /access_token|SECRET|provider body/u
    )
  })

  it("maps provider identifiers, signing health, URLs, and dates", () => {
    const result = toConnectedPageView(
      page({
        providerPageId: "provider-42",
        webhook: {
          url: "https://example.com/hook",
          signingEnabled: false,
        },
        connectedAt: "2026-07-29T18:00:00.000Z",
      })
    )

    expect(result).toMatchObject({
      metaPageId: "provider-42",
      webhookUrl: "https://example.com/hook",
      webhookSigningEnabled: false,
      connectedAt: "2026-07-29T18:00:00.000Z",
      connectedAtLabel: expect.any(String),
    })
  })

  it("returns no quota for an unlimited entitlement", async () => {
    const dependencies = dependenciesWith([])
    dependencies.getProductShell.mockResolvedValue(shell({ pageLimit: null }))

    await expect(
      loadConnectionsPageData(ACTOR, dependencies)
    ).resolves.toMatchObject({ kind: "ready", data: { quota: null } })
  })

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("not_found", "not_found", 404), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)(
    "maps access races to safe redirects",
    async (error, destination) => {
      const dependencies = dependenciesWith([])
      dependencies.listPages.mockRejectedValue(error)

      await expect(
        loadConnectionsPageData(ACTOR, dependencies)
      ).resolves.toEqual({ kind: "redirect", destination })
    }
  )

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("provider_unavailable", "transient", 502),
    rpcError("internal_error", "internal", 500),
  ])("fails closed for backend/protocol failures", async (error) => {
    const dependencies = dependenciesWith([])
    dependencies.listPages.mockRejectedValue(error)

    await expect(loadConnectionsPageData(ACTOR, dependencies)).rejects.toBe(
      error
    )
  })

  it.each([
    new BackendUnavailableError(),
    rpcError("provider_unavailable", "transient", 502),
    rpcError("internal_error", "internal", 500),
  ])("keeps the Page list when only quota is unavailable", async (error) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const dependencies = dependenciesWith([page()])
    dependencies.getProductShell.mockRejectedValue(error)

    const result = await loadConnectionsPageData(ACTOR, dependencies)

    expect(result).toMatchObject({
      kind: "ready",
      data: { pages: [{ id: page().id }], quota: null },
    })
    expect(warn).toHaveBeenCalledWith(
      "Connections quota unavailable.",
      expect.not.objectContaining({ message: expect.anything() })
    )
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /access_token|SECRET|raw/u
    )
    warn.mockRestore()
  })

  it("fails hard when the shell violates the backend protocol", async () => {
    const dependencies = dependenciesWith([page()])
    const error = new BackendProtocolError()
    dependencies.getProductShell.mockRejectedValue(error)

    await expect(loadConnectionsPageData(ACTOR, dependencies)).rejects.toBe(
      error
    )
  })

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("not_found", "not_found", 404), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)(
    "redirects when product access changes during the shell request",
    async (error, destination) => {
      const dependencies = dependenciesWith([page()])
      dependencies.getProductShell.mockRejectedValue(error)

      await expect(
        loadConnectionsPageData(ACTOR, dependencies)
      ).resolves.toEqual({ kind: "redirect", destination })
    }
  )
})

function dependenciesWith(pages: RpcPageDto[]) {
  return {
    listPages: vi.fn(async () => pages),
    getProductShell: vi.fn(async () => shell()),
  }
}

function shell(
  entitlementOverrides: Partial<ProductShellDto["entitlement"]> = {}
): ProductShellDto {
  return {
    tenantId: ACTOR.userId,
    email: "person@example.com",
    entitlement: {
      priceLookupKey: "starter_monthly",
      usage: 12,
      messageLimit: 50_000,
      activePageCount: 2,
      pageLimit: 3,
      blockCode: null,
      noticeLevel: null,
      ...entitlementOverrides,
    },
  }
}

function page(overrides: Partial<RpcPageDto> = {}): RpcPageDto {
  return {
    id: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
    provider: "meta",
    providerPageId: "provider-page",
    name: "Support",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenErrorAt: null,
    disconnectedAt: null,
    webhook: { url: null, signingEnabled: true },
    connectedAt: "2026-07-29T18:00:00.000Z",
    updatedAt: "2026-07-29T18:00:00.000Z",
    ...overrides,
  }
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "not_found"
    | "provider_unavailable"
    | "internal_error",
  kind: "access" | "not_found" | "transient" | "internal",
  status: 403 | 404 | 500 | 502
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: kind === "transient",
  })
}
