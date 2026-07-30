import "server-only"

import type {
  ConversationDto,
  ConversationListDto,
  ConversationListInput,
  ConversationThreadDto,
  ConversationThreadRpcInput,
  MessageDto,
} from "@workspace/contracts"

import type { ConversationListItem, ThreadMessage } from "./view-model"

const DEFAULT_PAGE_SIZE = 100

type CursorPage = {
  pagination: {
    hasMore: boolean
    nextCursor: string | null
  }
}

type CanonicalItem = {
  id: string
  createdAt: string
}

export type ConversationPageLoader = (
  input: ConversationListInput
) => Promise<ConversationListDto>

export type ThreadPageLoader = (
  input: ConversationThreadRpcInput
) => Promise<ConversationThreadDto>

export type ConversationFilters = Pick<
  ConversationListInput,
  "pageId" | "updatedAfter"
>

export type CollectedConversationThread = {
  conversation: ConversationListItem
  messages: ThreadMessage[]
}

export class RpcReadModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RpcReadModelError"
  }
}

export function mapConversationDto(
  conversation: ConversationDto
): ConversationListItem {
  return {
    id: conversation.id,
    contactId: conversation.contact.id,
    contactName: conversation.contact.name,
    lastMessageAt: parseContractDate(
      conversation.lastMessageAt,
      `conversation ${conversation.id} lastMessageAt`
    ),
    page: {
      id: conversation.page.id,
      metaPageId: conversation.page.providerPageId,
      name: conversation.page.name,
    },
    latestMessage: conversation.latestMessage
      ? {
          text: conversation.latestMessage.text,
          direction: conversation.latestMessage.direction,
          status: conversation.latestMessage.status,
          createdAt: parseContractDate(
            conversation.latestMessage.createdAt,
            `conversation ${conversation.id} latestMessage.createdAt`
          ),
        }
      : null,
  }
}

export function mapMessageDto(message: MessageDto): ThreadMessage {
  return {
    id: message.id,
    direction: message.direction,
    status: message.status,
    text: message.text,
    error: message.failure?.message ?? null,
    createdAt: parseContractDate(
      message.createdAt,
      `message ${message.id} createdAt`
    ),
  }
}

export async function collectConversations(
  loadPage: ConversationPageLoader,
  filters: ConversationFilters = {},
  pageSize = DEFAULT_PAGE_SIZE
): Promise<ConversationListItem[]> {
  assertPageSize(pageSize)

  const conversations: ConversationListItem[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let previous: CanonicalItem | undefined

  while (true) {
    const page = await loadPage({
      ...filters,
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    })

    assertPageProgress(page, cursor, seenCursors, "conversation")

    for (const conversation of page.data) {
      if (filters.pageId && conversation.page.id !== filters.pageId) {
        throw new RpcReadModelError(
          `conversation ${conversation.id} does not match pageId filter`
        )
      }

      const current = {
        id: conversation.id,
        createdAt: conversation.lastMessageAt,
      }
      assertCanonicalProgress(previous, current, seenIds, "conversation")
      conversations.push(mapConversationDto(conversation))
      previous = current
    }

    if (!page.pagination.hasMore) return conversations
    cursor = requireNextCursor(page, seenCursors, "conversation")
  }
}

export async function collectConversationThread(
  loadPage: ThreadPageLoader,
  conversationId: string,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<CollectedConversationThread> {
  assertPageSize(pageSize)

  const newestFirst: MessageDto[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let previous: CanonicalItem | undefined
  let conversation: ConversationDto | undefined

  while (true) {
    const page = await loadPage({
      conversationId,
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    })

    if (page.order !== "newest_first") {
      throw new RpcReadModelError(
        `thread ${conversationId} returned unsupported order`
      )
    }
    if (page.conversation.id !== conversationId) {
      throw new RpcReadModelError(
        `thread response does not match conversation ${conversationId}`
      )
    }

    assertPageProgress(page, cursor, seenCursors, "message")
    conversation ??= page.conversation

    for (const message of page.messages) {
      if (message.conversationId !== conversationId) {
        throw new RpcReadModelError(
          `message ${message.id} does not belong to conversation ${conversationId}`
        )
      }

      const current = { id: message.id, createdAt: message.createdAt }
      assertCanonicalProgress(previous, current, seenIds, "message")
      newestFirst.push(message)
      previous = current
    }

    if (!page.pagination.hasMore) break
    cursor = requireNextCursor(page, seenCursors, "message")
  }

  if (!conversation) {
    throw new RpcReadModelError(
      `thread ${conversationId} did not return a conversation`
    )
  }

  newestFirst.reverse()

  return {
    conversation: mapConversationDto(conversation),
    messages: newestFirst.map(mapMessageDto),
  }
}

function assertPageSize(pageSize: number) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RpcReadModelError("pageSize must be an integer from 1 to 100")
  }
}

function assertPageProgress(
  page: CursorPage & { data?: unknown[]; messages?: unknown[] },
  cursor: string | undefined,
  seenCursors: Set<string>,
  itemName: string
) {
  const items = page.data ?? page.messages ?? []
  const { hasMore, nextCursor } = page.pagination

  if (hasMore && items.length === 0) {
    throw new RpcReadModelError(
      `${itemName} pagination hasMore without any progress`
    )
  }
  if (hasMore && nextCursor && seenCursors.has(nextCursor)) {
    throw new RpcReadModelError(
      `${itemName} pagination repeated cursor ${nextCursor}`
    )
  }
  if (hasMore && (!nextCursor || nextCursor === cursor)) {
    throw new RpcReadModelError(
      `${itemName} pagination hasMore without a usable nextCursor`
    )
  }
  if (!hasMore && nextCursor !== null) {
    throw new RpcReadModelError(
      `${itemName} pagination returned a cursor after completion`
    )
  }
}

function requireNextCursor(
  page: CursorPage,
  seenCursors: Set<string>,
  itemName: string
) {
  const cursor = page.pagination.nextCursor
  if (!cursor) {
    throw new RpcReadModelError(
      `${itemName} pagination hasMore without a usable nextCursor`
    )
  }
  seenCursors.add(cursor)
  return cursor
}

function assertCanonicalProgress(
  previous: CanonicalItem | undefined,
  current: CanonicalItem,
  seenIds: Set<string>,
  itemName: string
) {
  if (seenIds.has(current.id)) {
    throw new RpcReadModelError(`${itemName} ${current.id} was repeated`)
  }

  const currentTime = contractTimestamp(
    current.createdAt,
    `${itemName} ${current.id} sort timestamp`
  )
  if (previous) {
    const previousTime = contractTimestamp(
      previous.createdAt,
      `${itemName} ${previous.id} sort timestamp`
    )
    const strictlyOlder =
      currentTime < previousTime ||
      (currentTime === previousTime && current.id < previous.id)

    if (!strictlyOlder) {
      throw new RpcReadModelError(
        `${itemName} pagination did not preserve newest_first order`
      )
    }
  }

  seenIds.add(current.id)
}

function parseContractDate(value: string, field: string) {
  const timestamp = contractTimestamp(value, field)
  return new Date(timestamp)
}

function contractTimestamp(value: string, field: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new RpcReadModelError(`${field} is not a valid date`)
  }
  return timestamp
}
