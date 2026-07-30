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
  getConversationThread,
  getBackend,
  getProductAccess,
  getProductShell,
  listConversations,
  listPages,
  smokeBackend,
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

function pageDto() {
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
  }
}
