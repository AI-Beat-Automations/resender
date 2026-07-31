import { auth } from "@/auth"
import { redirect } from "next/navigation"

import { ConversationLogList } from "@/features/messages/ui/conversation-log-list"
import {
  EmptyThread,
  MessageThread,
} from "@/features/messages/ui/message-thread"
import { MessagesPageFilter } from "@/features/messages/ui/messages-page-filter"
import {
  toConversationRowView,
  toThreadMessageViews,
} from "@/lib/messages/display"
import { loadMessagesPageData } from "@/lib/messages/page-data"

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; conversation?: string }>
}) {
  const session = await auth()
  const tenantId = session?.user?.id
  const { page: pageFilter, conversation: conversationParam } =
    await searchParams

  if (!tenantId) return null

  const result = await loadMessagesPageData({
    actor: { userId: tenantId },
    pageFilter,
    conversationId: conversationParam,
  })
  if (result.kind === "redirect") redirect(result.destination)

  const { pages, selectedPageId, conversations, selectedConversation, thread } =
    result.data

  const now = new Date()
  const rows = conversations.map((conversation) =>
    toConversationRowView(conversation, now)
  )
  const selectedRow =
    rows.find((row) => row.id === selectedConversation?.id) ?? null

  return (
    <div className="flex flex-col">
      <header>
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
          {"// mensajes"}
        </p>
        <h1 className="mt-1 font-heading text-[26px] font-bold tracking-[-0.02em]">
          Mensajes
        </h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-muted-foreground">
          Log durable organizado por conversación. Las respuestas salen de la
          API externa; esta pantalla es de solo lectura.
        </p>
        <MessagesPageFilter pages={pages} selectedPageId={selectedPageId} />
      </header>

      {/* Dos columnas con scroll propio (spec B4). La altura sale del viewport
          menos la cabecera y el padding del layout; el `min-h` evita que se
          aplaste cuando la franja de cuota empuja el contenido. */}
      <div className="mt-6 flex h-[calc(100svh-16rem)] min-h-[28rem] overflow-hidden rounded-[var(--radius-2xl)] border border-border">
        <ConversationLogList
          rows={rows}
          selectedConversationId={selectedRow?.id ?? null}
          selectedPageId={selectedPageId}
        />
        {selectedRow ? (
          <MessageThread
            header={{
              contactLabel: selectedRow.contactLabel,
              pageLabel: selectedRow.pageLabel,
            }}
            messages={toThreadMessageViews(thread)}
          />
        ) : (
          <EmptyThread filtered={Boolean(selectedPageId)} />
        )}
      </div>
    </div>
  )
}
