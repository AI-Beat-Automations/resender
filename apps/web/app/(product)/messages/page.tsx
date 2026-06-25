import Link from "next/link"

import { auth } from "@/auth"
import { formatContactLabel } from "@/lib/messages/display"
import {
  listConversationReadModel,
  listThreadMessages,
  type ConversationListItem,
  type ThreadMessage,
} from "@/lib/messages/read-model"
import { listTenantPages } from "@/lib/pages/page-registry"

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; conversation?: string }>
}) {
  const session = await auth()
  const tenantId = session?.user?.id
  const { page: pageFilter, conversation: conversationParam } = await searchParams

  if (!tenantId) return null

  const pages = await listTenantPages(tenantId)
  const validPageFilter = pages.some((page) => page.id === pageFilter)
    ? pageFilter
    : undefined
  const conversations = await listConversationReadModel({
    tenantId,
    connectedPageId: validPageFilter,
  })
  const selectedConversation =
    conversations.find((conversation) => conversation.id === conversationParam) ??
    conversations[0] ??
    null
  const thread = selectedConversation
    ? await listThreadMessages({
        tenantId,
        conversationId: selectedConversation.id,
      })
    : []

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Durable message log organized by conversation. Outbound messages
          originate from the external API; this screen is read-only.
        </p>
      </div>
      <PageFilter
        pages={pages.map((page) => ({ id: page.id, name: page.name }))}
        selectedPageId={validPageFilter}
      />
      <section className="grid min-h-[32rem] gap-4 lg:grid-cols-[22rem_1fr]">
        <ConversationList
          conversations={conversations}
          selectedConversationId={selectedConversation?.id ?? null}
          selectedPageId={validPageFilter}
        />
        <Thread conversation={selectedConversation} messages={thread} />
      </section>
    </div>
  )
}

function PageFilter({
  pages,
  selectedPageId,
}: {
  pages: Array<{ id: string; name: string }>
  selectedPageId?: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <FilterLink href="/messages" active={!selectedPageId}>
        All Pages
      </FilterLink>
      {pages.map((page) => (
        <FilterLink
          key={page.id}
          href={`/messages?page=${encodeURIComponent(page.id)}`}
          active={selectedPageId === page.id}
        >
          {page.name}
        </FilterLink>
      ))}
    </div>
  )
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  )
}

function ConversationList({
  conversations,
  selectedConversationId,
  selectedPageId,
}: {
  conversations: ConversationListItem[]
  selectedConversationId: string | null
  selectedPageId?: string
}) {
  return (
    <aside className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border p-4">
        <h2 className="font-medium">Conversations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sorted by recent activity.
        </p>
      </div>
      {conversations.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          No conversations for this filter.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {conversations.map((conversation) => (
            <ConversationLink
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === selectedConversationId}
              selectedPageId={selectedPageId}
            />
          ))}
        </div>
      )}
    </aside>
  )
}

function ConversationLink({
  conversation,
  active,
  selectedPageId,
}: {
  conversation: ConversationListItem
  active: boolean
  selectedPageId?: string
}) {
  const params = new URLSearchParams()
  if (selectedPageId) params.set("page", selectedPageId)
  params.set("conversation", conversation.id)

  return (
    <Link
      href={`/messages?${params.toString()}`}
      className={`block p-4 transition-colors ${
        active ? "bg-muted" : "hover:bg-muted/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium">
          {formatContactLabel(conversation.contactName, conversation.contactId)}
        </h3>
        <time className="shrink-0 text-xs text-muted-foreground">
          {conversation.lastMessageAt.toLocaleString()}
        </time>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {conversation.page.name} ({conversation.page.metaPageId})
      </p>
      {conversation.latestMessage && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {conversation.latestMessage.direction === "outbound" ? "You: " : ""}
          {conversation.latestMessage.text}
        </p>
      )}
    </Link>
  )
}

function Thread({
  conversation,
  messages,
}: {
  conversation: ConversationListItem | null
  messages: ThreadMessage[]
}) {
  if (!conversation) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
        No stored conversations to show yet.
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="border-b border-border p-4">
        <h2 className="font-medium">
          {formatContactLabel(conversation.contactName, conversation.contactId)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {conversation.page.name} ({conversation.page.metaPageId})
        </p>
      </header>
      <div className="grid gap-3 p-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </section>
  )
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === "outbound"
  const failed = message.status === "failed"

  return (
    <article className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] rounded-2xl border p-3 text-sm ${
          outbound
            ? "border-yellow-200 bg-yellow-50 text-yellow-950 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-100"
            : "border-green-200 bg-green-50 text-green-950 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-100"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-75">
          <span>{message.createdAt.toLocaleString()}</span>
          <span>{message.direction}</span>
          <span>{message.status}</span>
          {failed && <span className="font-medium text-destructive">failed</span>}
        </div>
        {failed && message.error && (
          <p className="mt-2 text-xs text-destructive">{message.error}</p>
        )}
      </div>
    </article>
  )
}
