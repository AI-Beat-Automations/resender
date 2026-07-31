import { describe, expect, it, vi } from "vitest"

import type {
  ConversationDto,
  ConversationListDto,
  ConversationThreadDto,
  ConversationThreadRpcInput,
  MessageDto,
  RpcActor,
  RpcPageDto,
} from "@workspace/contracts"

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { loadMessagesPageData } from "./page-data"

const ACTOR = { userId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15" }
const PAGE_ID = "f251bd5a-2772-489a-a725-43e2ea9d44ee"
const DISCONNECTED_PAGE_ID = "f251bd5a-2772-489a-a725-43e2ea9d44ef"
const CONVERSATION_ID = "9e2327a8-0c42-493e-bd6c-c08ed81010f0"
const OLDER_CONVERSATION_ID = "9e2327a8-0c42-493e-bd6c-c08ed81010ef"

describe("Messages RPC page consumer", () => {
  it("projects every Page, preserves the filter, and selects the newest conversation", async () => {
    const listPages = vi.fn(async () => [
      page(),
      page({
        id: DISCONNECTED_PAGE_ID,
        name: "Archive",
        status: "disconnected",
        disconnectedAt: "2026-07-29T19:00:00.000Z",
      }),
    ])
    const listConversationPage = vi.fn(async () =>
      conversationPage([
        conversation(),
        conversation({
          id: OLDER_CONVERSATION_ID,
          lastMessageAt: "2026-07-29T17:00:00.000Z",
        }),
      ])
    )
    const loadThreadPage = vi.fn(async () => threadPage([message()]))

    const result = await loadMessagesPageData(
      { actor: ACTOR, pageFilter: PAGE_ID },
      { listPages, listConversationPage, loadThreadPage }
    )

    expect(result).toMatchObject({
      kind: "ready",
      data: {
        pages: [
          { id: PAGE_ID, name: "Support" },
          { id: DISCONNECTED_PAGE_ID, name: "Archive" },
        ],
        selectedPageId: PAGE_ID,
        selectedConversation: { id: CONVERSATION_ID },
      },
    })
    expect(listPages).toHaveBeenCalledWith(ACTOR)
    expect(listConversationPage).toHaveBeenCalledWith(ACTOR, {
      pageId: PAGE_ID,
      limit: 100,
    })
    expect(loadThreadPage).toHaveBeenCalledWith(ACTOR, {
      conversationId: CONVERSATION_ID,
      limit: 100,
    })
  })

  it("ignores an invalid filter and requested conversation, then auto-selects newest", async () => {
    const dependencies = dependenciesWith({
      conversations: [
        conversation(),
        conversation({
          id: OLDER_CONVERSATION_ID,
          lastMessageAt: "2026-07-29T17:00:00.000Z",
        }),
      ],
    })

    const result = await loadMessagesPageData(
      {
        actor: ACTOR,
        pageFilter: DISCONNECTED_PAGE_ID,
        conversationId: "11e225da-5352-405d-b1c3-4f23419660af",
      },
      dependencies
    )

    expect(result).toMatchObject({
      kind: "ready",
      data: {
        selectedPageId: null,
        selectedConversation: { id: CONVERSATION_ID },
      },
    })
    expect(dependencies.listConversationPage).toHaveBeenCalledWith(ACTOR, {
      limit: 100,
    })
  })

  it("selects a valid non-first requested conversation", async () => {
    const dependencies = dependenciesWith({
      conversations: [
        conversation(),
        conversation({
          id: OLDER_CONVERSATION_ID,
          lastMessageAt: "2026-07-29T17:00:00.000Z",
        }),
      ],
    })
    const loadThreadPage = vi.fn(
      async (_actor: RpcActor, input: ConversationThreadRpcInput) =>
        threadPage([], conversation({ id: input.conversationId }))
    )

    const result = await loadMessagesPageData(
      { actor: ACTOR, conversationId: OLDER_CONVERSATION_ID },
      { ...dependencies, loadThreadPage }
    )

    expect(result).toMatchObject({
      kind: "ready",
      data: { selectedConversation: { id: OLDER_CONVERSATION_ID } },
    })
    expect(loadThreadPage).toHaveBeenCalledWith(ACTOR, {
      conversationId: OLDER_CONVERSATION_ID,
      limit: 100,
    })
  })

  it("returns the unfiltered empty state without loading a thread", async () => {
    const dependencies = dependenciesWith({ conversations: [] })

    await expect(
      loadMessagesPageData({ actor: ACTOR }, dependencies)
    ).resolves.toMatchObject({
      kind: "ready",
      data: {
        selectedPageId: null,
        conversations: [],
        selectedConversation: null,
        thread: [],
      },
    })
    expect(dependencies.loadThreadPage).not.toHaveBeenCalled()
  })

  it("preserves a valid Page filter with zero conversations", async () => {
    const dependencies = dependenciesWith({ conversations: [] })

    await expect(
      loadMessagesPageData({ actor: ACTOR, pageFilter: PAGE_ID }, dependencies)
    ).resolves.toMatchObject({
      kind: "ready",
      data: {
        selectedPageId: PAGE_ID,
        conversations: [],
        selectedConversation: null,
        thread: [],
      },
    })
    expect(dependencies.loadThreadPage).not.toHaveBeenCalled()
  })

  it("keeps the selected row with an empty thread when it disappears", async () => {
    const dependencies = dependenciesWith()
    dependencies.loadThreadPage.mockRejectedValue(
      rpcError("not_found", "not_found", 404)
    )

    await expect(
      loadMessagesPageData({ actor: ACTOR }, dependencies)
    ).resolves.toMatchObject({
      kind: "ready",
      data: {
        selectedConversation: { id: CONVERSATION_ID },
        thread: [],
      },
    })
  })

  it.each([
    ["account_waitlisted", "access", 403, "/waitlist"],
    ["subscription_required", "access", 403, "/billing"],
    ["not_found", "not_found", 404, "/waitlist"],
  ] as const)(
    "redirects a catalog %s race safely",
    async (code, kind, status, destination) => {
      const dependencies = dependenciesWith()
      dependencies.listPages.mockRejectedValue(rpcError(code, kind, status))

      await expect(
        loadMessagesPageData({ actor: ACTOR }, dependencies)
      ).resolves.toEqual({ kind: "redirect", destination })
    }
  )

  it("redirects a listConversations not_found race to the waitlist", async () => {
    const dependencies = dependenciesWith()
    dependencies.listConversationPage.mockRejectedValue(
      rpcError("not_found", "not_found", 404)
    )

    await expect(
      loadMessagesPageData({ actor: ACTOR }, dependencies)
    ).resolves.toEqual({ kind: "redirect", destination: "/waitlist" })
  })

  it.each([
    ["account_waitlisted", "/waitlist"],
    ["subscription_required", "/billing"],
  ] as const)("redirects a thread %s race", async (code, destination) => {
    const dependencies = dependenciesWith()
    dependencies.loadThreadPage.mockRejectedValue(rpcError(code, "access", 403))

    await expect(
      loadMessagesPageData({ actor: ACTOR }, dependencies)
    ).resolves.toEqual({ kind: "redirect", destination })
  })

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("internal_error", "internal", 500),
  ])("fails closed for backend and protocol errors", async (failure) => {
    const dependencies = dependenciesWith()
    dependencies.listConversationPage.mockRejectedValue(failure)

    await expect(
      loadMessagesPageData({ actor: ACTOR }, dependencies)
    ).rejects.toBe(failure)
  })

  it("does not log message, contact, or backend error data", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const dependencies = dependenciesWith()
    dependencies.loadThreadPage.mockRejectedValue({
      code: "provider_unavailable",
      status: 502,
      message:
        "access_token=SECRET contact=psid-sensitive body=sensitive-message",
    })

    await expect(
      loadMessagesPageData({ actor: ACTOR }, dependencies)
    ).rejects.toBeDefined()
    expect(error).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    error.mockRestore()
    info.mockRestore()
  })
})

function dependenciesWith(input: { conversations?: ConversationDto[] } = {}) {
  return {
    listPages: vi.fn(async () => [page()]),
    listConversationPage: vi.fn(async () =>
      conversationPage(input.conversations ?? [conversation()])
    ),
    loadThreadPage: vi.fn(async () => threadPage([message()])),
  }
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "not_found"
    | "internal_error",
  kind: "access" | "not_found" | "internal",
  status: 403 | 404 | 500
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: false,
    ...(code === "account_waitlisted"
      ? { destination: "/waitlist" as const }
      : code === "subscription_required"
        ? { destination: "/billing" as const }
        : {}),
  })
}

function page(overrides: Partial<RpcPageDto> = {}): RpcPageDto {
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

function conversation(
  overrides: Partial<ConversationDto> = {}
): ConversationDto {
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

function message(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "6b402566-9e1d-4739-bb61-81ac615a5469",
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

function conversationPage(data: ConversationDto[]): ConversationListDto {
  return { data, pagination: { hasMore: false, nextCursor: null } }
}

function threadPage(
  messages: MessageDto[],
  selectedConversation = conversation()
): ConversationThreadDto {
  return {
    conversation: selectedConversation,
    messages,
    pagination: { hasMore: false, nextCursor: null },
    order: "newest_first",
  }
}
