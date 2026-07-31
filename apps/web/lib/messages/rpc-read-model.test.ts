import { describe, expect, it, vi } from "vitest"

import type {
  ConversationDto,
  ConversationListDto,
  ConversationThreadDto,
  MessageDto,
} from "@workspace/contracts"

import {
  RpcReadModelError,
  collectConversationThread,
  collectConversations,
  mapConversationDto,
  mapMessageDto,
} from "./rpc-read-model"

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001"
const PAGE_ID = "00000000-0000-4000-8000-000000000002"

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`
}

function conversation(
  overrides: Partial<ConversationDto> = {}
): ConversationDto {
  return {
    id: CONVERSATION_ID,
    page: {
      id: PAGE_ID,
      providerPageId: "meta-page-42",
      name: "Página Norte",
    },
    contact: { id: "psid-42", name: "Ada" },
    latestMessage: {
      id: uuid(10),
      text: "Último mensaje",
      direction: "outbound",
      status: "failed",
      createdAt: "2026-07-29T16:00:00.000Z",
    },
    lastMessageAt: "2026-07-29T16:00:00.000Z",
    createdAt: "2026-07-29T15:00:00.000Z",
    updatedAt: "2026-07-29T16:00:00.000Z",
    ...overrides,
  }
}

function message(
  index: number,
  overrides: Partial<MessageDto> = {}
): MessageDto {
  return {
    id: uuid(index),
    conversationId: CONVERSATION_ID,
    pageId: PAGE_ID,
    contactId: "psid-42",
    direction: "inbound",
    status: "received",
    type: "text",
    text: `message-${index}`,
    provider: { name: "meta", messageId: `meta-${index}` },
    failure: null,
    createdAt: new Date(Date.UTC(2026, 6, 29, 16, 0, index)).toISOString(),
    ...overrides,
  }
}

function conversationPage(
  data: ConversationDto[],
  hasMore = false,
  nextCursor: string | null = null
): ConversationListDto {
  return { data, pagination: { hasMore, nextCursor } }
}

function threadPage(
  messages: MessageDto[],
  hasMore = false,
  nextCursor: string | null = null
): ConversationThreadDto {
  return {
    conversation: conversation(),
    messages,
    pagination: { hasMore, nextCursor },
    order: "newest_first",
  }
}

describe("RPC read-model mappers", () => {
  it("preserves provider, direction, status, errors and parses dates", () => {
    const mappedConversation = mapConversationDto(conversation())
    const mappedMessage = mapMessageDto(
      message(1, {
        direction: "outbound",
        status: "failed",
        failure: { message: "Meta rejected the message" },
      })
    )

    expect(mappedConversation.page).toEqual({
      id: PAGE_ID,
      metaPageId: "meta-page-42",
      name: "Página Norte",
    })
    expect(mappedConversation.lastMessageAt).toEqual(
      new Date("2026-07-29T16:00:00.000Z")
    )
    expect(mappedConversation.latestMessage).toMatchObject({
      direction: "outbound",
      status: "failed",
    })
    expect(mappedConversation.latestMessage?.createdAt).toBeInstanceOf(Date)
    expect(mappedMessage).toMatchObject({
      direction: "outbound",
      status: "failed",
      error: "Meta rejected the message",
    })
    expect(mappedMessage.createdAt).toBeInstanceOf(Date)
  })

  it("fails closed when a contract date cannot be parsed", () => {
    expect(() =>
      mapMessageDto(message(1, { createdAt: "not-a-date" }))
    ).toThrowError(RpcReadModelError)
    expect(() =>
      mapConversationDto(
        conversation({
          latestMessage: {
            id: uuid(10),
            text: "bad timestamp",
            direction: "inbound",
            status: "received",
            createdAt: "not-a-date",
          },
        })
      )
    ).toThrow(/latestMessage\.createdAt is not a valid date/)
  })
})

describe("collectConversations", () => {
  it("keeps newest_first order and forwards the Page filter on every page", async () => {
    const first = conversation({
      id: uuid(3),
      lastMessageAt: "2026-07-29T16:00:00.000Z",
    })
    const second = conversation({
      id: uuid(2),
      lastMessageAt: "2026-07-29T16:00:00.000Z",
    })
    const third = conversation({
      id: uuid(1),
      lastMessageAt: "2026-07-29T15:00:00.000Z",
    })
    const pages = [
      conversationPage([first, second], true, "cursor-1"),
      conversationPage([third]),
    ]
    const loadPage = vi.fn(async () => pages.shift()!)

    const result = await collectConversations(
      loadPage,
      {
        pageId: PAGE_ID,
        updatedAfter: "2026-07-01T00:00:00.000Z",
      },
      2
    )

    expect(result.map(({ id }) => id)).toEqual([uuid(3), uuid(2), uuid(1)])
    expect(loadPage).toHaveBeenNthCalledWith(1, {
      pageId: PAGE_ID,
      updatedAfter: "2026-07-01T00:00:00.000Z",
      limit: 2,
    })
    expect(loadPage).toHaveBeenNthCalledWith(2, {
      pageId: PAGE_ID,
      updatedAfter: "2026-07-01T00:00:00.000Z",
      limit: 2,
      cursor: "cursor-1",
    })
  })

  it("rejects a conversation outside the requested Page filter", async () => {
    const loadPage = async () =>
      conversationPage([
        conversation({
          page: {
            id: uuid(999),
            providerPageId: "other",
            name: "Other",
          },
        }),
      ])

    await expect(
      collectConversations(loadPage, { pageId: PAGE_ID })
    ).rejects.toThrow(/does not match pageId filter/)
  })
})

describe("collectConversationThread", () => {
  it("collects 201 messages without gaps and reverses the full result once", async () => {
    const newestFirst = Array.from({ length: 201 }, (_, offset) => {
      const rank = 201 - offset
      return message(rank)
    })
    const pages = [
      threadPage(newestFirst.slice(0, 100), true, "cursor-100"),
      threadPage(newestFirst.slice(100, 200), true, "cursor-200"),
      threadPage(newestFirst.slice(200)),
    ]
    const loadPage = vi.fn(async () => pages.shift()!)

    const result = await collectConversationThread(
      loadPage,
      CONVERSATION_ID,
      100
    )

    expect(result.messages).toHaveLength(201)
    expect(result.messages.map(({ id }) => id)).toEqual(
      newestFirst.map(({ id }) => id).reverse()
    )
    expect(new Set(result.messages.map(({ id }) => id)).size).toBe(201)
    expect(loadPage).toHaveBeenNthCalledWith(1, {
      conversationId: CONVERSATION_ID,
      limit: 100,
    })
    expect(loadPage).toHaveBeenNthCalledWith(2, {
      conversationId: CONVERSATION_ID,
      limit: 100,
      cursor: "cursor-100",
    })
    expect(loadPage).toHaveBeenNthCalledWith(3, {
      conversationId: CONVERSATION_ID,
      limit: 100,
      cursor: "cursor-200",
    })
  })

  it("uses id as the canonical tiebreaker for equal timestamps", async () => {
    const tiedAt = "2026-07-29T16:00:00.000Z"
    const loadPage = async () =>
      threadPage([
        message(3, { createdAt: tiedAt }),
        message(2, { createdAt: tiedAt }),
        message(1, { createdAt: tiedAt }),
      ])

    const result = await collectConversationThread(loadPage, CONVERSATION_ID)

    expect(result.messages.map(({ id }) => id)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
    ])
  })

  it("rejects a repeated cursor", async () => {
    const pages = [
      threadPage([message(3)], true, "same-cursor"),
      threadPage([message(2)], true, "same-cursor"),
    ]
    const loadPage = async () => pages.shift()!

    await expect(
      collectConversationThread(loadPage, CONVERSATION_ID)
    ).rejects.toThrow(/repeated cursor/)
  })

  it("rejects hasMore without a cursor", async () => {
    const loadPage = async () => threadPage([message(1)], true, null)

    await expect(
      collectConversationThread(loadPage, CONVERSATION_ID)
    ).rejects.toThrow(/hasMore without a usable nextCursor/)
  })

  it("rejects hasMore when the page made no data progress", async () => {
    const loadPage = async () => threadPage([], true, "cursor-1")

    await expect(
      collectConversationThread(loadPage, CONVERSATION_ID)
    ).rejects.toThrow(/hasMore without any progress/)
  })

  it("rejects duplicate data even when the cursor changes", async () => {
    const duplicate = message(2)
    const pages = [
      threadPage([duplicate], true, "cursor-1"),
      threadPage([duplicate]),
    ]
    const loadPage = async () => pages.shift()!

    await expect(
      collectConversationThread(loadPage, CONVERSATION_ID)
    ).rejects.toThrow(/was repeated/)
  })
})
