import "server-only"

import type {
  ConversationListDto,
  ConversationListInput,
  ConversationThreadDto,
  ConversationThreadRpcInput,
  RpcActor,
  RpcPageDto,
} from "@workspace/contracts"

import {
  BackendRpcError,
  getConversationThread,
  listConversations,
  listPages,
} from "@/lib/backend/backend"

import {
  collectConversationThread,
  collectConversations,
} from "./rpc-read-model"
import type { ConversationListItem, ThreadMessage } from "./view-model"

type MessagesPageDependencies = {
  listPages(actor: RpcActor): Promise<RpcPageDto[]>
  listConversationPage(
    actor: RpcActor,
    input: ConversationListInput
  ): Promise<ConversationListDto>
  loadThreadPage(
    actor: RpcActor,
    input: ConversationThreadRpcInput
  ): Promise<ConversationThreadDto>
}

const DEFAULT_DEPENDENCIES: MessagesPageDependencies = {
  listPages,
  listConversationPage: listConversations,
  loadThreadPage: getConversationThread,
}

export type MessagesPageData = {
  pages: Array<{ id: string; name: string }>
  selectedPageId: string | null
  conversations: ConversationListItem[]
  selectedConversation: ConversationListItem | null
  thread: ThreadMessage[]
}

export type MessagesPageLoadResult =
  | { kind: "ready"; data: MessagesPageData }
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }

export async function loadMessagesPageData(
  input: {
    actor: RpcActor
    pageFilter?: string
    conversationId?: string
  },
  dependencies: MessagesPageDependencies = DEFAULT_DEPENDENCIES
): Promise<MessagesPageLoadResult> {
  let phase: "catalog" | "thread" = "catalog"
  try {
    const rpcPages = await dependencies.listPages(input.actor)
    const pages = rpcPages.map(({ id, name }) => ({ id, name }))
    const selectedPageId = pages.some(({ id }) => id === input.pageFilter)
      ? input.pageFilter
      : undefined
    const conversations = await collectConversations(
      (pageInput) => dependencies.listConversationPage(input.actor, pageInput),
      selectedPageId ? { pageId: selectedPageId } : {}
    )
    const selectedConversation =
      conversations.find(
        (conversation) => conversation.id === input.conversationId
      ) ??
      conversations[0] ??
      null
    phase = "thread"
    const thread = selectedConversation
      ? await loadThreadOrEmpty(
          dependencies,
          input.actor,
          selectedConversation.id
        )
      : []

    return {
      kind: "ready",
      data: {
        pages,
        selectedPageId: selectedPageId ?? null,
        conversations,
        selectedConversation,
        thread,
      },
    }
  } catch (error) {
    const destination = raceDestination(error, phase)
    if (destination) return { kind: "redirect", destination }
    throw error
  }
}

async function loadThreadOrEmpty(
  dependencies: MessagesPageDependencies,
  actor: RpcActor,
  conversationId: string
) {
  try {
    const result = await collectConversationThread(
      (threadInput) => dependencies.loadThreadPage(actor, threadInput),
      conversationId
    )
    return result.messages
  } catch (error) {
    if (
      error instanceof BackendRpcError &&
      error.classification.kind === "not_found"
    ) {
      return []
    }
    throw error
  }
}

function raceDestination(
  error: unknown,
  phase: "catalog" | "thread"
): "/waitlist" | "/billing" | null {
  if (!(error instanceof BackendRpcError)) return null
  if (error.classification.code === "account_waitlisted") return "/waitlist"
  if (error.classification.code === "subscription_required") return "/billing"
  if (phase === "catalog" && error.classification.code === "not_found") {
    return "/waitlist"
  }
  return null
}
