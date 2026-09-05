import Link from "next/link"
import type { ReactNode } from "react"
import { MessageSquare } from "lucide-react"

import { getSession } from "@/lib/auth/session"
import { CommentThread } from "@/features/comments/ui/comment-thread"
import { PublicationLogList } from "@/features/comments/ui/publication-log-list"
import { EmptyPane } from "@/features/inbox/ui/empty-pane"
import {
  InboxAccountFilter,
  type InboxFilterAccount,
} from "@/features/inbox/ui/inbox-account-filter"
import { InboxTabsNav } from "@/features/inbox/ui/inbox-tabs-nav"
import { ConversationLogList } from "@/features/messages/ui/conversation-log-list"
import {
  EmptyThread,
  MessageThread,
} from "@/features/messages/ui/message-thread"
import {
  formatPublicationKey,
  toCommentBubbleViews,
  toPublicationRowView,
} from "@/lib/comments/display"
import {
  listPublicationComments,
  listPublicationReadModel,
} from "@/lib/comments/read-model"
import {
  firstParam,
  resolveInboxTab,
  type InboxTab,
} from "@/lib/inbox/inbox-tabs"
import {
  mediaKey,
  resolveContactProfiles,
  resolveMedia,
} from "@/lib/inbox/label-resolver"
import {
  toConversationRowView,
  toThreadMessageViews,
} from "@/lib/messages/display"
import {
  listConversationReadModel,
  listThreadMessages,
} from "@/lib/messages/read-model"
import { listTenantPages } from "@/lib/pages/page-registry"
import type { AppDict } from "@/content/i18n/app"
import { getAppDict } from "@/lib/i18n/app-dict"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[]
    page?: string | string[]
    conversation?: string | string[]
    media?: string | string[]
  }>
}) {
  const [session, params, t] = await Promise.all([
    getSession(),
    searchParams,
    getAppDict(),
  ])
  const tenantId = session?.user?.id

  if (!tenantId) return null

  const tab = resolveInboxTab(params.tab)
  const accounts = await listTenantPages(tenantId)
  // En comentarios el filtro solo lista Instagram: los comentarios no existen
  // en Messenger, y una opción que siempre devuelve cero es un control muerto.
  // Filtrar acá además invalida solo el `?page=` de una cuenta de Messenger al
  // cambiar de modo, sin tener que limpiarlo aparte.
  const filterable =
    tab === "comentarios"
      ? accounts.filter((account) => account.channel === "instagram")
      : accounts
  const accountParam = firstParam(params.page)
  const accountId = filterable.some((account) => account.id === accountParam)
    ? accountParam
    : undefined

  // La columna de la lista lleva el conteo del modo, que solo se sabe tras la
  // consulta del modo: cada uno la dibuja con su número en vez de consultar
  // dos veces, y mete sus filas como `children`.
  const renderList = (count: number, children: ReactNode) => (
    <ListColumn
      tab={tab}
      accountId={accountId ?? null}
      accounts={filterable.map((account) => ({
        id: account.id,
        name: account.name,
      }))}
      count={count}
      t={t}
    >
      {children}
    </ListColumn>
  )

  return (
    <InboxSurface>
      {tab === "comentarios" ? (
        <ComentariosMode
          tenantId={tenantId}
          accountId={accountId}
          mediaParam={firstParam(params.media)}
          hasInstagram={filterable.length > 0}
          renderList={renderList}
          t={t}
        />
      ) : (
        <MensajesMode
          tenantId={tenantId}
          accountId={accountId}
          conversationParam={firstParam(params.conversation)}
          renderList={renderList}
          t={t}
        />
      )}
    </InboxSurface>
  )
}

/**
 * La pantalla entera es UNA superficie (mock 1h/1i): un solo borde con la
 * lista a la izquierda y el hilo a la derecha, sin tarjetas separadas. Ocupa
 * lo que queda bajo el header de 52 px y el padding del layout (1.5rem por
 * lado); si la franja de cuota empuja, la página hace scroll.
 */
function InboxSurface({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100svh-52px-3rem)] min-h-[32rem] overflow-hidden rounded-xl border bg-card">
      {children}
    </div>
  )
}

// Columna izquierda: cabecera de 52 px con «Inbox», el conteo del modo y la
// píldora «solo lectura»; debajo las pestañas de modo y el filtro por cuenta,
// y luego las filas (`children`). Sin buscador ni filtro por plataforma:
// no hay dato detrás, y un control muerto es peor que ninguno.
function ListColumn({
  tab,
  accountId,
  accounts,
  count,
  children,
  t,
}: {
  tab: InboxTab
  accountId: string | null
  accounts: InboxFilterAccount[]
  count: number
  children: ReactNode
  t: AppDict
}) {
  return (
    <section className="flex w-[380px] shrink-0 flex-col border-r border-border-subtle">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-base font-semibold">
            {t.inbox.title}
          </h1>
          <Badge
            variant="secondary"
            className="h-auto rounded-[5px] bg-accent px-1.5 py-px font-mono text-[11px] font-normal text-[var(--text-body)]"
            title={t.inbox.countTitle[tab]}
          >
            {count.toLocaleString(t.intl)}
          </Badge>
        </div>
        {/* Declara lo que la pantalla no tiene: no hay compositor, las
            respuestas salen por la API externa. */}
        <Badge
          variant="outline"
          className="h-auto gap-1.5 rounded-full px-[9px] py-[3px] text-[11.5px] font-normal text-muted-foreground"
          title={t.inbox.readOnlyHint}
        >
          <span
            className="size-1.5 rounded-full bg-[var(--text-subtle)]"
            aria-hidden
          />
          {t.inbox.readOnly}
        </Badge>
      </header>
      <div className="flex shrink-0 flex-col gap-2.5 px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <InboxTabsNav
            active={tab}
            accountId={accountId}
            counts={{ [tab]: count }}
            t={t}
          />
          <InboxAccountFilter
            tab={tab}
            accounts={accounts}
            selectedAccountId={accountId}
          />
        </div>
      </div>
      {children}
    </section>
  )
}

async function MensajesMode({
  tenantId,
  accountId,
  conversationParam,
  renderList,
  t,
}: {
  tenantId: string
  accountId: string | undefined
  conversationParam: string | undefined
  renderList: (count: number, children: ReactNode) => ReactNode
  t: AppDict
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

  // El @handle del contacto no viene en el webhook de DMs: hay que pedirlo a
  // Graph. Se resuelve acá y no al ingerir para que las conversaciones que ya
  // existían se completen la primera vez que alguien las mira.
  const profiles = await resolveContactProfiles(
    tenantId,
    conversations.map((conversation) => ({
      conversationId: conversation.id,
      connectedPageId: conversation.page.id,
      channel: conversation.page.channel,
      contactId: conversation.contactId,
      contactUsername: conversation.contactUsername,
      contactSyncedAt: conversation.contactSyncedAt,
    }))
  )

  const now = new Date()
  const rows = conversations.map((conversation) => {
    const profile = profiles.get(conversation.id)
    return toConversationRowView(
      profile
        ? {
            ...conversation,
            contactUsername: profile.username,
            contactName: profile.name,
          }
        : conversation,
      now,
      t
    )
  })
  const selectedRow =
    rows.find((row) => row.id === selectedConversation?.id) ?? null

  return (
    <>
      {renderList(
        rows.length,
        <ConversationLogList
          rows={rows}
          selectedConversationId={selectedRow?.id ?? null}
          selectedAccountId={accountId ?? null}
          t={t}
        />
      )}
      {selectedRow ? (
        <MessageThread
          header={{
            contactLabel: selectedRow.contactLabel,
            pageLabel: selectedRow.pageLabel,
            channel: selectedRow.channel,
          }}
          messages={toThreadMessageViews(thread, t)}
          t={t}
        />
      ) : (
        <EmptyThread filtered={Boolean(accountId)} t={t} />
      )}
    </>
  )
}

async function ComentariosMode({
  tenantId,
  accountId,
  mediaParam,
  hasInstagram,
  renderList,
  t,
}: {
  tenantId: string
  accountId: string | undefined
  mediaParam: string | undefined
  hasInstagram: boolean
  renderList: (count: number, children: ReactNode) => ReactNode
  t: AppDict
}) {
  // Sin cuenta de Instagram no hay hueco que llenar: es el único vacío
  // accionable de la pantalla, así que el hilo lleva CTA. La lista se queda
  // con su cabecera y sus pestañas para poder volver a Mensajes.
  if (!hasInstagram) {
    return (
      <>
        {renderList(
          0,
          <PublicationLogList
            rows={[]}
            selectedKey={null}
            selectedAccountId={null}
            t={t}
          />
        )}
        <EmptyPane
          icon={MessageSquare}
          title={t.inbox.noInstagramTitle}
          body={t.inbox.noInstagramBody}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/connections">{t.inbox.noInstagramCta}</Link>
            </Button>
          }
        />
      </>
    )
  }

  const publications = await listPublicationReadModel({
    tenantId,
    connectedPageId: accountId,
  })
  // La selección se valida contra la lista ya cargada, nunca parseando el
  // parámetro: un `?media=` rancio u hostil no llega jamás al SQL. Igual que
  // con `?conversation=`, se abre la publicación con actividad más reciente.
  const selected =
    publications.find(
      (publication) => formatPublicationKey(publication) === mediaParam
    ) ??
    publications[0] ??
    null
  const thread = selected
    ? await listPublicationComments({
        tenantId,
        connectedPageId: selected.connectedPageId,
        mediaId: selected.mediaId,
      })
    : []

  // Ni el permalink ni el caption vienen en el webhook de comentarios; mismo
  // trato que el @handle del contacto en mensajes.
  const media = await resolveMedia(tenantId, publications)

  const now = new Date()
  const rows = publications.map((publication) =>
    toPublicationRowView(
      publication,
      now,
      t,
      media.get(mediaKey(publication.connectedPageId, publication.mediaId))
    )
  )
  const selectedRow =
    rows.find(
      (row) => row.key === (selected && formatPublicationKey(selected))
    ) ?? null

  return (
    <>
      {renderList(
        rows.length,
        <PublicationLogList
          rows={rows}
          selectedKey={selectedRow?.key ?? null}
          selectedAccountId={accountId ?? null}
          t={t}
        />
      )}
      {selectedRow ? (
        <CommentThread
          header={{
            mediaLabel: selectedRow.mediaLabel,
            mediaPermalink: selectedRow.mediaPermalink,
            accountLabel: selectedRow.accountLabel,
          }}
          comments={toCommentBubbleViews(thread, t)}
          t={t}
        />
      ) : (
        <EmptyPane
          icon={MessageSquare}
          title={
            accountId
              ? t.inbox.noCommentsFilteredTitle
              : t.inbox.noCommentsTitle
          }
          body={
            accountId ? t.inbox.noCommentsFilteredBody : t.inbox.noCommentsBody
          }
        />
      )}
    </>
  )
}
