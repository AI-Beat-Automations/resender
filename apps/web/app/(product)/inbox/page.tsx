import Link from "next/link"
import type { ReactNode } from "react"
import { Eye, MessageSquare } from "lucide-react"

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

  // La cabecera lleva el conteo del modo, que solo se sabe tras la consulta
  // del modo: cada uno la dibuja con su número en vez de consultar dos veces.
  const renderHeader = (count: number) => (
    <InboxHeader
      tab={tab}
      accountId={accountId ?? null}
      accounts={filterable.map((account) => ({
        id: account.id,
        name: account.name,
      }))}
      count={count}
      t={t}
    />
  )

  return (
    <div className="flex flex-col gap-5">
      {tab === "comentarios" ? (
        <ComentariosMode
          tenantId={tenantId}
          accountId={accountId}
          mediaParam={firstParam(params.media)}
          hasInstagram={filterable.length > 0}
          renderHeader={renderHeader}
          t={t}
        />
      ) : (
        <MensajesMode
          tenantId={tenantId}
          accountId={accountId}
          conversationParam={firstParam(params.conversation)}
          renderHeader={renderHeader}
          t={t}
        />
      )}
    </div>
  )
}

// Cabecera de la pantalla (ADR 0015, mock 1h): título con el conteo del modo
// en `Badge` y el «solo lectura» en `Badge outline`, y debajo las pestañas y
// el filtro por cuenta. Sin buscador ni filtro por plataforma: fuera de scope.
function InboxHeader({
  tab,
  accountId,
  accounts,
  count,
  t,
}: {
  tab: InboxTab
  accountId: string | null
  accounts: InboxFilterAccount[]
  count: number
  t: AppDict
}) {
  return (
    <header className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">
            {t.inbox.title}
          </h1>
          <Badge
            variant="secondary"
            className="font-mono"
            title={t.inbox.countTitle[tab]}
          >
            {count.toLocaleString(t.intl)}
          </Badge>
          <Badge variant="outline" title={t.inbox.readOnlyHint}>
            <Eye aria-hidden />
            {t.inbox.readOnly}
          </Badge>
        </div>
        <p className="mt-1.5 max-w-[640px] text-sm/[1.55] text-muted-foreground">
          {t.inbox.subtitle}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InboxTabsNav active={tab} accountId={accountId} t={t} />
        <div className="w-full sm:w-[260px]">
          <InboxAccountFilter
            tab={tab}
            accounts={accounts}
            selectedAccountId={accountId}
          />
        </div>
      </div>
    </header>
  )
}

async function MensajesMode({
  tenantId,
  accountId,
  conversationParam,
  renderHeader,
  t,
}: {
  tenantId: string
  accountId: string | undefined
  conversationParam: string | undefined
  renderHeader: (count: number) => ReactNode
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
      {renderHeader(rows.length)}
      <InboxPanels>
        <ConversationLogList
          rows={rows}
          selectedConversationId={selectedRow?.id ?? null}
          selectedAccountId={accountId ?? null}
          t={t}
        />
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
      </InboxPanels>
    </>
  )
}

async function ComentariosMode({
  tenantId,
  accountId,
  mediaParam,
  hasInstagram,
  renderHeader,
  t,
}: {
  tenantId: string
  accountId: string | undefined
  mediaParam: string | undefined
  hasInstagram: boolean
  renderHeader: (count: number) => ReactNode
  t: AppDict
}) {
  // Sin cuenta de Instagram no hay hueco que llenar: es el único vacío
  // accionable de la pantalla, así que ocupa el ancho entero y lleva CTA en
  // vez de dibujar dos columnas con las dos mitades vacías.
  if (!hasInstagram) {
    return (
      <>
        {renderHeader(0)}
        <InboxPanels>
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
        </InboxPanels>
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
      {renderHeader(rows.length)}
      <InboxPanels>
        <PublicationLogList
          rows={rows}
          selectedKey={selectedRow?.key ?? null}
          selectedAccountId={accountId ?? null}
          t={t}
        />
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
              accountId
                ? t.inbox.noCommentsFilteredBody
                : t.inbox.noCommentsBody
            }
          />
        )}
      </InboxPanels>
    </>
  )
}

/**
 * Dos columnas con scroll propio (spec B4): la lista en `Card` de 360 px y el
 * hilo en la suya. La altura sale del viewport menos la cabecera y el padding
 * del layout; el `min-h` evita que se aplaste cuando la franja de cuota
 * empuja el contenido. Vive una sola vez porque los dos modos comparten la
 * misma caja.
 */
function InboxPanels({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100svh-17rem)] min-h-[28rem] gap-4">
      {children}
    </div>
  )
}
