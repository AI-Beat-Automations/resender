import { readFile } from "node:fs/promises"

import { beforeEach, describe, expect, it, vi } from "vitest"

const openNext = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
}))

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: openNext.getCloudflareContext,
}))

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
  authenticateCredentials,
  changePassword,
  createApiKey,
  createBillingPortalSession,
  createCheckoutSession,
  deleteAccount,
  disconnectPage,
  getConversationThread,
  getBackend,
  getBillingState,
  getProductAccess,
  getProductShell,
  listConversations,
  listApiKeys,
  listPages,
  revokeApiKey,
  registerUser,
  rotateWebhookSecret,
  smokeBackend,
  updatePageWebhook,
  verifyCheckoutSession,
} from "./backend"

type AdapterBackend = Awaited<ReturnType<typeof getBackend>>
type AdapterExposesFetcher = "fetch" extends keyof AdapterBackend ? true : false
const ADAPTER_EXPOSES_FETCHER: AdapterExposesFetcher = false
const ACTOR = { userId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15" }

describe("backend RPC adapter", () => {
  beforeEach(() => {
    openNext.getCloudflareContext.mockReset()
  })

  it("resolves the async OpenNext context for every call", async () => {
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      service: "api",
      entrypoint: "rpc",
    })
    const fetch = vi.fn()
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { fetch, health } },
    })

    await expect(smokeBackend()).resolves.toEqual({
      status: "ok",
      service: "api",
      entrypoint: "rpc",
    })
    await getBackend()

    expect(openNext.getCloudflareContext).toHaveBeenCalledTimes(2)
    expect(openNext.getCloudflareContext).toHaveBeenNthCalledWith(1, {
      async: true,
    })
    expect(openNext.getCloudflareContext).toHaveBeenNthCalledWith(2, {
      async: true,
    })
    expect(health).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(ADAPTER_EXPOSES_FETCHER).toBe(false)
  })

  it("fails with a generic error when the OpenNext context is unavailable", async () => {
    openNext.getCloudflareContext.mockRejectedValue(
      new Error("DATABASE_URL=must-not-leak")
    )

    const error = await captureError(getBackend())

    expect(error).toBeInstanceOf(BackendUnavailableError)
    expect(String(error)).toBe(
      "BackendUnavailableError: Backend service is unavailable."
    )
    expect(JSON.stringify(error)).not.toMatch(/DATABASE_URL|must-not-leak/u)
  })

  it("fails with the same generic error when BACKEND is missing", async () => {
    openNext.getCloudflareContext.mockResolvedValue({ env: {} })

    await expect(getBackend()).rejects.toThrowError(BackendUnavailableError)
    await expect(getBackend()).rejects.toThrow(
      "Backend service is unavailable."
    )
  })

  it("classifies backend failures without retaining raw messages", async () => {
    const health = vi.fn().mockRejectedValue({
      code: "provider_unavailable",
      status: 502,
      message: "provider-token=must-not-leak",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { health } },
    })

    const error = await captureError(smokeBackend())
    if (!(error instanceof BackendRpcError)) {
      throw new Error("Expected BackendRpcError")
    }

    expect(error.message).toBe("Backend request failed.")
    expect(error.classification).toEqual({
      kind: "transient",
      code: "provider_unavailable",
      status: 502,
      retryable: true,
    })
    expect(JSON.stringify(error)).not.toMatch(/provider-token|must-not-leak/u)
  })

  it("rejects malformed health DTOs without retaining the response", async () => {
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      service: "api",
      entrypoint: "rpc",
      secret: "must-not-leak",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { health } },
    })

    const error = await captureError(smokeBackend())

    expect(error).toBeInstanceOf(BackendProtocolError)
    expect(String(error)).toBe(
      "BackendProtocolError: Backend response is invalid."
    )
    expect(JSON.stringify(error)).not.toMatch(/secret|must-not-leak/u)
  })

  it("authenticates and registers through RPC with validated safe user DTOs", async () => {
    const authenticate = vi.fn().mockResolvedValue(authenticatedUser())
    const register = vi
      .fn()
      .mockResolvedValue(authenticatedUser({ waitlisted: true }))
    openNext.getCloudflareContext
      .mockResolvedValueOnce({
        env: { BACKEND: { authenticateCredentials: authenticate } },
      })
      .mockResolvedValueOnce({
        env: { BACKEND: { registerUser: register } },
      })

    await expect(
      authenticateCredentials({
        email: "person@example.com",
        password: "long-enough",
      })
    ).resolves.toEqual(authenticatedUser())
    await expect(
      registerUser({
        email: "person@example.com",
        password: "long-enough",
      })
    ).resolves.toEqual(authenticatedUser({ waitlisted: true }))
    expect(authenticate).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "long-enough",
    })
    expect(register).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "long-enough",
    })
  })

  it.each(["unknown", "wrong password", "deleted"] as const)(
    "keeps %s credentials indistinguishable",
    async () => {
      const authenticate = vi.fn().mockResolvedValue(null)
      openNext.getCloudflareContext.mockResolvedValue({
        env: { BACKEND: { authenticateCredentials: authenticate } },
      })

      await expect(
        authenticateCredentials({
          email: "person@example.com",
          password: "candidate-password",
        })
      ).resolves.toBeNull()
    }
  )

  it.each([
    ["malformed", { ...authenticatedUser(), id: "not-a-uuid" }],
    ["another email", authenticatedUser({ email: "attacker@example.com" })],
    [
      "password hash",
      { ...authenticatedUser(), passwordHash: "hash-must-not-cross" },
    ],
    [
      "provider token",
      { ...authenticatedUser(), metaUserAccessToken: "token-must-not-cross" },
    ],
    ["nested secret", { ...authenticatedUser(), extra: { salt: "leak" } }],
  ])(
    "rejects %s credential DTOs without retaining data",
    async (_name, dto) => {
      openNext.getCloudflareContext.mockResolvedValue({
        env: {
          BACKEND: {
            authenticateCredentials: vi.fn().mockResolvedValue(dto),
          },
        },
      })

      const error = await captureError(
        authenticateCredentials({
          email: "person@example.com",
          password: "candidate-password",
        })
      )

      expect(error).toBeInstanceOf(BackendProtocolError)
      expect(JSON.stringify(error)).not.toMatch(
        /attacker@example|hash-must-not-cross|token-must-not-cross|leak/u
      )
    }
  )

  it("fails closed with sanitized unavailable and RPC credential errors", async () => {
    openNext.getCloudflareContext
      .mockRejectedValueOnce(new Error("binding-secret-must-not-leak"))
      .mockResolvedValueOnce({
        env: {
          BACKEND: {
            registerUser: vi.fn().mockRejectedValue({
              code: "internal_error",
              status: 500,
              message: "database-secret-must-not-leak",
            }),
          },
        },
      })

    const unavailable = await captureError(
      authenticateCredentials({
        email: "person@example.com",
        password: "candidate-password",
      })
    )
    const rpc = await captureError(
      registerUser({
        email: "person@example.com",
        password: "candidate-password",
      })
    )

    expect(unavailable).toBeInstanceOf(BackendUnavailableError)
    expect(rpc).toBeInstanceOf(BackendRpcError)
    expect(JSON.stringify([unavailable, rpc])).not.toMatch(
      /binding-secret|database-secret|must-not-leak/u
    )
  })

  it("passes only the session-derived actor to product access", async () => {
    const productAccess = vi.fn().mockResolvedValue({
      userExists: true,
      waitlisted: false,
      subscriptionActive: true,
      destination: "product",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { getProductAccess: productAccess } },
    })

    await expect(getProductAccess(ACTOR)).resolves.toEqual({
      userExists: true,
      waitlisted: false,
      subscriptionActive: true,
      destination: "product",
    })
    expect(productAccess).toHaveBeenCalledOnce()
    expect(productAccess).toHaveBeenCalledWith(ACTOR)
  })

  it("rejects incoherent product access without retaining backend data", async () => {
    const productAccess = vi.fn().mockResolvedValue({
      userExists: false,
      waitlisted: false,
      subscriptionActive: false,
      destination: "billing",
      databaseUrl: "must-not-leak",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { getProductAccess: productAccess } },
    })

    const error = await captureError(getProductAccess(ACTOR))

    expect(error).toBeInstanceOf(BackendProtocolError)
    expect(JSON.stringify(error)).not.toMatch(/databaseUrl|must-not-leak/u)
  })

  it("accepts an older additive shell DTO for the same actor", async () => {
    const productShell = vi.fn().mockResolvedValue({
      tenantId: ACTOR.userId,
      email: "person@example.com",
      entitlement: {
        priceLookupKey: "starter_monthly",
        usage: 10,
        messageLimit: 50_000,
        activePageCount: 1,
        pageLimit: 2,
        blockCode: null,
      },
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { getProductShell: productShell } },
    })

    await expect(getProductShell(ACTOR)).resolves.toMatchObject({
      tenantId: ACTOR.userId,
      entitlement: { blockCode: null },
    })
    expect(productShell).toHaveBeenCalledOnce()
    expect(productShell).toHaveBeenCalledWith(ACTOR)
  })

  it("rejects a shell for another actor without retaining its data", async () => {
    const productShell = vi.fn().mockResolvedValue({
      tenantId: "53a10f5b-5e16-47f3-b60e-e3c094630eb4",
      email: "other@example.com",
      entitlement: {
        priceLookupKey: "starter_monthly",
        usage: 0,
        messageLimit: 50_000,
        activePageCount: 0,
        pageLimit: 2,
        blockCode: null,
        noticeLevel: null,
      },
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { getProductShell: productShell } },
    })

    const error = await captureError(getProductShell(ACTOR))

    expect(error).toBeInstanceOf(BackendProtocolError)
    expect(JSON.stringify(error)).not.toMatch(/other@example/u)
  })

  it("passes the exact actor and validates conversation and Page DTOs", async () => {
    const conversations = vi.fn().mockResolvedValue({
      data: [conversationDto()],
      pagination: { hasMore: false, nextCursor: null },
    })
    const pages = vi.fn().mockResolvedValue([pageDto()])
    openNext.getCloudflareContext
      .mockResolvedValueOnce({
        env: { BACKEND: { listConversations: conversations } },
      })
      .mockResolvedValueOnce({ env: { BACKEND: { listPages: pages } } })

    await expect(
      listConversations(ACTOR, { pageId: PAGE_ID, limit: 100 })
    ).resolves.toMatchObject({ data: [{ id: CONVERSATION_ID }] })
    await expect(listPages(ACTOR)).resolves.toMatchObject([
      { id: PAGE_ID, name: "Support" },
    ])
    expect(conversations).toHaveBeenCalledWith(ACTOR, {
      pageId: PAGE_ID,
      limit: 100,
    })
    expect(pages).toHaveBeenCalledWith(ACTOR)
  })

  it("sanitizes Page state and rejects duplicate Page ids", async () => {
    const rawTokenError = "access_token=SECRET legacy provider response"
    const listPagesRpc = vi
      .fn()
      .mockResolvedValueOnce([
        pageDto({
          tokenStatus: "invalid",
          tokenError: rawTokenError,
          tokenErrorAt: "2026-07-29T18:01:00.000Z",
          pageAccessTokenEncrypted: "ciphertext-SECRET",
          webhookSigningSecretEncrypted: "signing-SECRET",
        }),
      ])
      .mockResolvedValueOnce([pageDto(), pageDto()])
    openNext.getCloudflareContext
      .mockResolvedValueOnce({ env: { BACKEND: { listPages: listPagesRpc } } })
      .mockResolvedValueOnce({ env: { BACKEND: { listPages: listPagesRpc } } })

    const result = await listPages(ACTOR)

    expect(result[0]?.tokenError).toBe(
      "The Page credential is invalid. Reconnect the Page."
    )
    expect(JSON.stringify(result)).not.toMatch(
      /access_token|SECRET|pageAccessToken|webhookSigningSecret|ciphertext/u
    )
    await expect(listPages(ACTOR)).rejects.toThrowError(BackendProtocolError)
  })

  it("validates Page mutation identities and terminal statuses", async () => {
    const update = vi.fn().mockResolvedValue(pageDto())
    const disconnect = vi
      .fn()
      .mockResolvedValue(pageDto({ status: "disconnected" }))
    const rotate = vi.fn().mockResolvedValue({
      secret: "whsec_reveal_once",
      createdAt: "2026-07-29T18:03:00.000Z",
      persistedSecret: "must-not-leak",
    })
    openNext.getCloudflareContext
      .mockResolvedValueOnce({
        env: { BACKEND: { updatePageWebhook: update } },
      })
      .mockResolvedValueOnce({
        env: { BACKEND: { disconnectPage: disconnect } },
      })
      .mockResolvedValueOnce({
        env: { BACKEND: { rotateWebhookSecret: rotate } },
      })

    await expect(
      updatePageWebhook(ACTOR, {
        pageId: PAGE_ID,
        webhookUrl: "https://example.com/hook",
      })
    ).resolves.toMatchObject({ id: PAGE_ID, status: "active" })
    await expect(
      disconnectPage(ACTOR, { pageId: PAGE_ID })
    ).resolves.toMatchObject({ id: PAGE_ID, status: "disconnected" })
    const secret = await rotateWebhookSecret(ACTOR, { pageId: PAGE_ID })

    expect(update).toHaveBeenCalledWith(ACTOR, {
      pageId: PAGE_ID,
      webhookUrl: "https://example.com/hook",
    })
    expect(disconnect).toHaveBeenCalledWith(ACTOR, { pageId: PAGE_ID })
    expect(rotate).toHaveBeenCalledWith(ACTOR, { pageId: PAGE_ID })
    expect(secret).toEqual({
      secret: "whsec_reveal_once",
      createdAt: "2026-07-29T18:03:00.000Z",
    })
    expect(JSON.stringify(secret)).not.toContain("persistedSecret")
  })

  it.each([
    ["update", "disconnected", OTHER_PAGE_ID],
    ["disconnect", "active", PAGE_ID],
  ] as const)(
    "rejects incoherent %s Page mutation responses",
    async (operation, status, id) => {
      const rpc = vi.fn().mockResolvedValue(pageDto({ id, status }))
      openNext.getCloudflareContext.mockResolvedValue({
        env: {
          BACKEND:
            operation === "update"
              ? { updatePageWebhook: rpc }
              : { disconnectPage: rpc },
        },
      })

      const result =
        operation === "update"
          ? updatePageWebhook(ACTOR, { pageId: PAGE_ID, webhookUrl: null })
          : disconnectPage(ACTOR, { pageId: PAGE_ID })

      await expect(result).rejects.toThrowError(BackendProtocolError)
    }
  )

  it("rejects malformed signing-secret responses without retaining them", async () => {
    const rotate = vi.fn().mockResolvedValue({
      secret: "access_token=SECRET",
      createdAt: "not-a-date",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { rotateWebhookSecret: rotate } },
    })

    const error = await captureError(
      rotateWebhookSecret(ACTOR, { pageId: PAGE_ID })
    )

    expect(error).toBeInstanceOf(BackendProtocolError)
    expect(JSON.stringify(error)).not.toMatch(/access_token|SECRET/u)
  })

  it("lists API key metadata in canonical order without persistence fields or full keys", async () => {
    const listApiKeysRpc = vi.fn().mockResolvedValue([
      apiKeyDto({
        id: API_KEY_ID,
        createdAt: "2026-07-30T18:00:00.000Z",
        secretHash: "hash-SECRET",
        pepper: "pepper-SECRET",
        tenantId: ACTOR.userId,
        apiKey: API_KEY,
      }),
      apiKeyDto({
        id: OTHER_API_KEY_ID,
        status: "revoked",
        createdAt: "2026-07-29T18:00:00.000Z",
        revokedAt: "2026-07-30T19:00:00.000Z",
      }),
    ])
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { listApiKeys: listApiKeysRpc } },
    })

    const result = await listApiKeys(ACTOR)

    expect(listApiKeysRpc).toHaveBeenCalledWith(ACTOR)
    expect(result.map((key) => key.id)).toEqual([API_KEY_ID, OTHER_API_KEY_ID])
    expect(result[1]).toMatchObject({
      status: "revoked",
      revokedAt: "2026-07-30T19:00:00.000Z",
    })
    expect(JSON.stringify(result)).not.toMatch(
      /hash-SECRET|pepper-SECRET|tenantId|apiKey|pk_live_a{20}/u
    )
  })

  it.each([
    [
      "duplicate ids",
      [apiKeyDto({ id: API_KEY_ID }), apiKeyDto({ id: API_KEY_ID })],
    ],
    [
      "non-canonical order",
      [
        apiKeyDto({ createdAt: "2026-07-29T18:00:00.000Z" }),
        apiKeyDto({
          id: OTHER_API_KEY_ID,
          createdAt: "2026-07-30T18:00:00.000Z",
        }),
      ],
    ],
    ["full key in the visible prefix", [apiKeyDto({ visiblePrefix: API_KEY })]],
  ])("rejects API key lists with %s", async (_name, response) => {
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { listApiKeys: vi.fn().mockResolvedValue(response) } },
    })

    await expect(listApiKeys(ACTOR)).rejects.toThrowError(BackendProtocolError)
  })

  it("creates and revokes API keys with exact actors, ids, and terminal status", async () => {
    const create = vi.fn().mockResolvedValue({
      apiKey: API_KEY,
      record: apiKeyDto({
        secretHash: "hash-SECRET",
        pepper: "pepper-SECRET",
      }),
    })
    const revoke = vi.fn().mockResolvedValue(
      apiKeyDto({
        status: "revoked",
        revokedAt: "2026-07-30T19:00:00.000Z",
      })
    )
    openNext.getCloudflareContext
      .mockResolvedValueOnce({ env: { BACKEND: { createApiKey: create } } })
      .mockResolvedValueOnce({ env: { BACKEND: { revokeApiKey: revoke } } })

    const created = await createApiKey(ACTOR, { label: "Production" })
    const revoked = await revokeApiKey(ACTOR, { apiKeyId: API_KEY_ID })

    expect(create).toHaveBeenCalledWith(ACTOR, { label: "Production" })
    expect(revoke).toHaveBeenCalledWith(ACTOR, { apiKeyId: API_KEY_ID })
    expect(created).toEqual({
      apiKey: API_KEY,
      record: apiKeyDto(),
    })
    expect(revoked).toMatchObject({
      id: API_KEY_ID,
      status: "revoked",
      revokedAt: "2026-07-30T19:00:00.000Z",
    })
    expect(JSON.stringify(created.record)).not.toMatch(/hash|pepper|SECRET/u)
  })

  it.each([
    [
      "create status",
      "create",
      {
        apiKey: API_KEY,
        record: apiKeyDto({
          status: "revoked",
          revokedAt: "2026-07-30T19:00:00.000Z",
        }),
      },
    ],
    [
      "create secret",
      "create",
      { apiKey: "pk_live_SECRET", record: apiKeyDto() },
    ],
    [
      "revoke id",
      "revoke",
      apiKeyDto({
        id: OTHER_API_KEY_ID,
        status: "revoked",
        revokedAt: "2026-07-30T19:00:00.000Z",
      }),
    ],
    ["revoke status", "revoke", apiKeyDto()],
  ] as const)(
    "rejects incoherent API key mutation response: %s",
    async (_name, operation, response) => {
      openNext.getCloudflareContext.mockResolvedValue({
        env: {
          BACKEND:
            operation === "create"
              ? { createApiKey: vi.fn().mockResolvedValue(response) }
              : { revokeApiKey: vi.fn().mockResolvedValue(response) },
        },
      })

      const result =
        operation === "create"
          ? createApiKey(ACTOR, { label: "Production" })
          : revokeApiKey(ACTOR, { apiKeyId: API_KEY_ID })
      const error = await captureError(result)

      expect(error).toBeInstanceOf(BackendProtocolError)
      expect(JSON.stringify(error)).not.toMatch(/pk_live_SECRET/u)
    }
  )

  it("validates billing RPC DTOs and passes only the exact actor and minimal inputs", async () => {
    const getState = vi.fn().mockResolvedValue({
      ...billingState(),
      serverVersion: 2,
    })
    const createCheckout = vi.fn().mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/session-token",
    })
    const createPortal = vi.fn().mockResolvedValue({
      url: "https://billing.stripe.com/p/session/portal-token",
    })
    const verify = vi.fn().mockResolvedValue({ complete: false })
    openNext.getCloudflareContext
      .mockResolvedValueOnce({
        env: { BACKEND: { getBillingState: getState } },
      })
      .mockResolvedValueOnce({
        env: { BACKEND: { createCheckoutSession: createCheckout } },
      })
      .mockResolvedValueOnce({
        env: { BACKEND: { createBillingPortalSession: createPortal } },
      })
      .mockResolvedValueOnce({
        env: { BACKEND: { verifyCheckoutSession: verify } },
      })

    await expect(getBillingState(ACTOR)).resolves.toEqual(billingState())
    await expect(
      createCheckoutSession(ACTOR, {
        priceLookupKey: "starter_monthly",
        origin: "https://resender.dev",
      })
    ).resolves.toEqual({
      url: "https://checkout.stripe.com/c/pay/session-token",
    })
    await expect(
      createBillingPortalSession(ACTOR, {
        origin: "https://resender.dev",
      })
    ).resolves.toEqual({
      url: "https://billing.stripe.com/p/session/portal-token",
    })
    await expect(
      verifyCheckoutSession(ACTOR, {
        sessionId: "cs_test_1234567890abcdef",
      })
    ).resolves.toEqual({ complete: false })

    expect(getState).toHaveBeenCalledWith(ACTOR)
    expect(createCheckout).toHaveBeenCalledWith(ACTOR, {
      priceLookupKey: "starter_monthly",
      origin: "https://resender.dev",
    })
    expect(createPortal).toHaveBeenCalledWith(ACTOR, {
      origin: "https://resender.dev",
    })
    expect(verify).toHaveBeenCalledWith(ACTOR, {
      sessionId: "cs_test_1234567890abcdef",
    })
  })

  it.each([
    ["http", "http://checkout.stripe.com/c/pay/token", "checkout"],
    ["foreign host", "https://attacker.example/session", "checkout"],
    [
      "checkout host for portal",
      "https://checkout.stripe.com/c/pay/token",
      "portal",
    ],
    [
      "sensitive checkout field",
      "https://checkout.stripe.com/c/pay/token",
      "checkout-sensitive",
    ],
  ] as const)(
    "rejects %s Stripe redirect responses",
    async (_name, url, kind) => {
      const response = {
        url,
        ...(kind === "checkout-sensitive"
          ? { stripeCustomerId: "cus_must_not_cross" }
          : {}),
      }
      openNext.getCloudflareContext.mockResolvedValue({
        env: {
          BACKEND:
            kind === "portal"
              ? {
                  createBillingPortalSession: vi
                    .fn()
                    .mockResolvedValue(response),
                }
              : { createCheckoutSession: vi.fn().mockResolvedValue(response) },
        },
      })

      const result =
        kind === "portal"
          ? createBillingPortalSession(ACTOR, {
              origin: "https://resender.dev",
            })
          : createCheckoutSession(ACTOR, {
              priceLookupKey: "starter_monthly",
              origin: "https://resender.dev",
            })
      const error = await captureError(result)

      expect(error).toBeInstanceOf(BackendProtocolError)
      expect(JSON.stringify(error)).not.toMatch(/cus_must_not_cross|attacker/u)
    }
  )

  it.each([
    ["billing state", "state"],
    ["verification", "verification"],
  ] as const)(
    "rejects sensitive identifiers in %s responses",
    async (_name, operation) => {
      const response =
        operation === "state"
          ? {
              ...billingState(),
              subscription: {
                ...billingState().subscription,
                stripeSubscriptionId: "sub_must_not_cross",
              },
            }
          : {
              complete: true,
              customerId: "cus_must_not_cross",
            }
      openNext.getCloudflareContext.mockResolvedValue({
        env: {
          BACKEND:
            operation === "state"
              ? { getBillingState: vi.fn().mockResolvedValue(response) }
              : {
                  verifyCheckoutSession: vi.fn().mockResolvedValue(response),
                },
        },
      })

      const result =
        operation === "state"
          ? getBillingState(ACTOR)
          : verifyCheckoutSession(ACTOR, {
              sessionId: "cs_live_1234567890abcdef",
            })
      const error = await captureError(result)

      expect(error).toBeInstanceOf(BackendProtocolError)
      expect(JSON.stringify(error)).not.toMatch(/cus_|sub_/u)
    }
  )

  it("validates password and account-deletion RPC terminal responses", async () => {
    const change = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue({
      deleted: true,
      metaUnsubscribeFailures: 2,
      stripeCancellationFailed: true,
      stripeSubscriptionId: "sub_SECRET",
      pageAccessToken: "token_SECRET",
    })
    openNext.getCloudflareContext
      .mockResolvedValueOnce({ env: { BACKEND: { changePassword: change } } })
      .mockResolvedValueOnce({ env: { BACKEND: { deleteAccount: remove } } })

    await expect(
      changePassword(ACTOR, { newPassword: "long-enough" })
    ).resolves.toBeUndefined()
    const result = await deleteAccount(ACTOR, {
      confirmEmail: "person@example.com",
    })

    expect(change).toHaveBeenCalledWith(ACTOR, {
      newPassword: "long-enough",
    })
    expect(remove).toHaveBeenCalledWith(ACTOR, {
      confirmEmail: "person@example.com",
    })
    expect(result).toEqual({
      deleted: true,
      metaUnsubscribeFailures: 2,
      stripeCancellationFailed: true,
    })
    expect(JSON.stringify(result)).not.toMatch(
      /sub_SECRET|token_SECRET|stripeSubscriptionId|pageAccessToken/u
    )
  })

  it.each([
    ["password", { changed: true }],
    [
      "deletion",
      {
        deleted: "yes",
        metaUnsubscribeFailures: 0,
        stripeCancellationFailed: false,
        raw: "SECRET",
      },
    ],
  ] as const)(
    "rejects malformed %s terminal responses",
    async (operation, response) => {
      openNext.getCloudflareContext.mockResolvedValue({
        env: {
          BACKEND:
            operation === "password"
              ? { changePassword: vi.fn().mockResolvedValue(response) }
              : { deleteAccount: vi.fn().mockResolvedValue(response) },
        },
      })

      const result =
        operation === "password"
          ? changePassword(ACTOR, { newPassword: "long-enough" })
          : deleteAccount(ACTOR, { confirmEmail: "person@example.com" })

      await expect(result).rejects.toThrowError(BackendProtocolError)
    }
  )

  it("rejects a thread whose resource ownership is incoherent", async () => {
    const thread = vi.fn().mockResolvedValue({
      conversation: conversationDto(),
      messages: [
        messageDto({
          conversationId: OTHER_CONVERSATION_ID,
          text: "sensitive-body-must-not-leak",
        }),
      ],
      pagination: { hasMore: false, nextCursor: null },
      order: "newest_first",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { getConversationThread: thread } },
    })

    const error = await captureError(
      getConversationThread(ACTOR, {
        conversationId: CONVERSATION_ID,
        limit: 100,
      })
    )

    expect(thread).toHaveBeenCalledWith(ACTOR, {
      conversationId: CONVERSATION_ID,
      limit: 100,
    })
    expect(error).toBeInstanceOf(BackendProtocolError)
    expect(JSON.stringify(error)).not.toMatch(/sensitive-body|must-not-leak/u)
  })

  it("strips unknown provider and persistence fields from a valid thread", async () => {
    const thread = vi.fn().mockResolvedValue({
      conversation: conversationDto(),
      messages: [
        messageDto({
          providerResponse: { access_token: "SECRET" },
          idempotencyKey: "SECRET-key",
          idempotencyFingerprint: "SECRET-fingerprint",
          token: "SECRET-token",
        }),
      ],
      pagination: { hasMore: false, nextCursor: null },
      order: "newest_first",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { getConversationThread: thread } },
    })

    const result = await getConversationThread(ACTOR, {
      conversationId: CONVERSATION_ID,
      limit: 100,
    })

    expect(result.messages).toHaveLength(1)
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|providerResponse|idempotency|fingerprint|token/u
    )
  })

  it("rejects a conversation outside the requested Page", async () => {
    const conversations = vi.fn().mockResolvedValue({
      data: [
        conversationDto({
          page: {
            id: OTHER_PAGE_ID,
            providerPageId: "other",
            name: "Other",
          },
        }),
      ],
      pagination: { hasMore: false, nextCursor: null },
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { listConversations: conversations } },
    })

    await expect(
      listConversations(ACTOR, { pageId: PAGE_ID, limit: 100 })
    ).rejects.toThrowError(BackendProtocolError)
  })

  it("rejects a thread message for another contact", async () => {
    const thread = vi.fn().mockResolvedValue({
      conversation: conversationDto(),
      messages: [messageDto({ contactId: "another-contact" })],
      pagination: { hasMore: false, nextCursor: null },
      order: "newest_first",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { getConversationThread: thread } },
    })

    await expect(
      getConversationThread(ACTOR, {
        conversationId: CONVERSATION_ID,
        limit: 100,
      })
    ).rejects.toThrowError(BackendProtocolError)
  })

  it("keeps the adapter guarded by Next server-only", async () => {
    const source = await readFile(
      new URL("./backend.ts", import.meta.url),
      "utf8"
    )

    expect(source.startsWith('import "server-only"')).toBe(true)
  })
})

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("Expected promise to reject")
}

const PAGE_ID = "f251bd5a-2772-489a-a725-43e2ea9d44ee"
const OTHER_PAGE_ID = "f251bd5a-2772-489a-a725-43e2ea9d44ef"
const API_KEY_ID = "61c94a3a-c22f-47f8-ab1f-b797307cea31"
const OTHER_API_KEY_ID = "61c94a3a-c22f-47f8-ab1f-b797307cea32"
const API_KEY = `pk_live_${"a".repeat(43)}`
const CONVERSATION_ID = "9e2327a8-0c42-493e-bd6c-c08ed81010f0"
const OTHER_CONVERSATION_ID = "9e2327a8-0c42-493e-bd6c-c08ed81010f1"

function conversationDto(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    page: {
      id: PAGE_ID,
      providerPageId: "provider_page_1",
      name: "Support",
    },
    contact: { id: "psid", name: null },
    latestMessage: null,
    lastMessageAt: "2026-07-29T18:00:00.000Z",
    createdAt: "2026-07-29T18:00:00.000Z",
    updatedAt: "2026-07-29T18:00:00.000Z",
    ...overrides,
  }
}

function messageDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    conversationId: CONVERSATION_ID,
    pageId: PAGE_ID,
    contactId: "psid",
    direction: "inbound",
    status: "received",
    type: "text",
    text: "hello",
    provider: { name: "meta", messageId: "mid.1" },
    failure: null,
    createdAt: "2026-07-29T18:00:00.000Z",
    ...overrides,
  }
}

function pageDto(overrides: Record<string, unknown> = {}) {
  return {
    id: PAGE_ID,
    provider: "meta",
    providerPageId: "provider_page_1",
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

function apiKeyDto(overrides: Record<string, unknown> = {}) {
  return {
    id: API_KEY_ID,
    label: "Production",
    visiblePrefix: "pk_live_aaaaaaaa",
    status: "active",
    createdAt: "2026-07-30T18:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function billingState() {
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
      usage: 100,
      messageLimit: 50_000,
      activePageCount: 1,
      pageLimit: 2,
      blockCode: null,
      noticeLevel: null,
    },
  }
}

function authenticatedUser(
  overrides: Partial<{
    id: string
    email: string
    waitlisted: boolean
    createdAt: string
  }> = {}
) {
  return {
    id: ACTOR.userId,
    email: "person@example.com",
    waitlisted: false,
    createdAt: "2026-07-30T18:00:00.000Z",
    ...overrides,
  }
}
