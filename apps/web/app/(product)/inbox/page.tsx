import type { ReactNode } from "react"

import { auth } from "@/auth"
import { InboxAccountFilter } from "@/features/inbox/ui/inbox-account-filter"
import { InboxTabsNav } from "@/features/inbox/ui/inbox-tabs-nav"
import { ConversationLogList } from "@/features/messages/ui/conversation-log-list"
import {
  EmptyThread,
  MessageThread,
} from "@/features/messages/ui/message-thread"
import { firstParam, resolveInboxTab } from "@/lib/inbox/inbox-tabs"
import {
  toConversationRowView,
  toThreadMessageViews,
} from "@/lib/messages/display"
import {
  listConversationReadModel,
  listThreadMessages,
} from "@/lib/messages/read-model"
import { listTenantPages } from "@/lib/pages/page-registry"

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[]
    page?: string | string[]
    conversation?: string | string[]
  }>
}) {
  const [session, params] = await Promise.all([auth(), searchParams])
  const tenantId = session?.user?.id

  if (!tenantId) return null

  const tab = resolveInboxTab(params.tab)
  const accounts = await listTenantPages(tenantId)
  const accountParam = firstParam(params.page)
  const accountId = accounts.some((account) => account.id === accountParam)
    ? accountParam
    : undefined

  return (
    <div className="flex flex-col">
      <header>
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
          {"// inbox"}
        </p>
        <h1 className="mt-1 font-heading text-[26px] font-bold tracking-[-0.02em]">
          Inbox
        </h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-muted-foreground">
          Log durable de mensajes y comentarios. Las respuestas salen de la API
          externa; esta pantalla es de solo lectura.
        </p>
        <InboxTabsNav active={tab} accountId={accountId ?? null} />
        <InboxAccountFilter
          tab={tab}
          accounts={accounts.map((account) => ({
            id: account.id,
            name: account.name,
          }))}
          selectedAccountId={accountId ?? null}
        />
      </header>

      <MensajesMode
        tenantId={tenantId}
        accountId={accountId}
        conversationParam={firstParam(params.conversation)}
      />
    </div>
  )
}

async function MensajesMode({
  tenantId,
  accountId,
  conversationParam,
}: {
  tenantId: string
  accountId: string | undefined
  conversationParam: string | undefined
}) {
  const conversations = await listConversationReadModel({
    tenantId,
    connectedPageId: accountId,
  })
  // Al entrar a Inbox se abre la conversación más reciente: el read model ya
  // viene ordenado por `last_message_at desc`.
  const selectedConversation =
    conversations.find(
      (conversation) => conversation.id === conversationParam
    ) ??
    conversations[0] ??
    null
  const thread = selectedConversation
    ? await listThreadMessages({
        tenantId,
        conversationId: selectedConversation.id,
      })
    : []

  const now = new Date()
  const rows = conversations.map((conversation) =>
    toConversationRowView(conversation, now)
  )
  const selectedRow =
    rows.find((row) => row.id === selectedConversation?.id) ?? null

  return (
    <InboxPanels>
      <ConversationLogList
        rows={rows}
        selectedConversationId={selectedRow?.id ?? null}
        selectedAccountId={accountId ?? null}
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
        <EmptyThread filtered={Boolean(accountId)} />
      )}
    </InboxPanels>
  )
}

/**
 * Dos columnas con scroll propio (spec B4). La altura sale del viewport menos
 * la cabecera y el padding del layout; el `min-h` evita que se aplaste cuando
 * la franja de cuota empuja el contenido. Vive una sola vez porque los dos
 * modos comparten la misma caja.
 */
function InboxPanels({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex h-[calc(100svh-16rem)] min-h-[28rem] overflow-hidden rounded-[var(--radius-2xl)] border border-border">
      {children}
    </div>
  )
}
