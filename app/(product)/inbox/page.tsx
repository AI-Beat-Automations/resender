import Link from "next/link"
import type { ReactNode } from "react"
import { MessageSquare } from "lucide-react"

import { getProductActor } from "@/features/shell/queries"
import { CommentThread } from "@/features/comments/ui/comment-thread"
import { PublicationLogList } from "@/features/comments/ui/publication-log-list"
import { EmptyPane } from "@/features/inbox/ui/empty-pane"
import type { InboxFilterAccount } from "@/features/inbox/ui/inbox-account-combobox"
import { InboxListPanel } from "@/features/inbox/ui/inbox-list-panel"
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
  formatAccountShortLabel,
  toConversationRowView,
  toThreadMessageViews,
} from "@/lib/messages/display"
import {
  listConversationReadModel,
  listThreadMessages,
} from "@/lib/messages/read-model"
import { scopeOf, type ConnectionScope } from "@/lib/pages/connection-scope"
import { listTenantPages } from "@/lib/pages/page-registry"
import type { AppDict } from "@/content/i18n/app"
import { getAppDict } from "@/lib/i18n/app-dict"
import { Button } from "@/components/ui/button"

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
  const [actor, params, t] = await Promise.all([
    getProductActor(),
    searchParams,
    getAppDict(),
  ])

  if (!actor) return null

  // Todo el Inbox lee dentro del alcance de quien mira (ADR 0020): la persona
  // de un cliente de agencia solo ve las cuentas de su cliente, y el `?page=`,
  // `?conversation=` y `?media=` se validan contra esas listas.
  const scope = scopeOf(actor)
  const tab = resolveInboxTab(params.tab)
  const accounts = await listTenantPages(scope)
  // En comentarios el filtro solo lista Instagram: los comentarios no existen
  // en Messenger, y una píldora que siempre devuelve cero es un control muerto.
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
  // El desplegable nombra la cuenta como la fila: @handle, número o nombre.
  const filterAccounts: InboxFilterAccount[] = filterable.map((account) => ({
    id: account.id,
    label: formatAccountShortLabel(account),
  }))
  const panel = {
    tab,
    accounts: filterAccounts,
    selectedAccountId: accountId ?? null,
    t,
  }

  return tab === "comentarios" ? (
    <ComentariosMode
      scope={scope}
      accountId={accountId}
      mediaParam={firstParam(params.media)}
      hasInstagram={filterable.length > 0}
      panel={panel}
      t={t}
    />
  ) : (
    <MensajesMode
      scope={scope}
      accountId={accountId}
      conversationParam={firstParam(params.conversation)}
      panel={panel}
      t={t}
    />
  )
}

// Lo que el panel de lista necesita y los dos modos comparten.
type PanelProps = {
  tab: InboxTab
  accounts: InboxFilterAccount[]
  selectedAccountId: string | null
  t: AppDict
}

async function MensajesMode({
  scope,
  accountId,
  conversationParam,
  panel,
  t,
}: {
  scope: ConnectionScope
  accountId: string | undefined
  conversationParam: string | undefined
  panel: PanelProps
  t: AppDict
}) {
  const conversations = await listConversationReadModel({
    scope,
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
        scope,
        conversationId: selectedConversation.id,
      })
    : []

  // El @handle del contacto no viene en el webhook de DMs: hay que pedirlo a
  // Graph. Se resuelve acá y no al ingerir para que las conversaciones que ya
  // existían se completen la primera vez que alguien las mira.
  const profiles = await resolveContactProfiles(
    scope,
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
    <InboxPanels>
      <InboxListPanel {...panel} count={rows.length}>
        <ConversationLogList
          rows={rows}
          selectedConversationId={selectedRow?.id ?? null}
          selectedAccountId={accountId ?? null}
          t={t}
        />
      </InboxListPanel>
      {selectedRow ? (
        <MessageThread
          header={{
            contactLabel: selectedRow.contactLabel,
            accountLabel: selectedRow.accountLabel,
            channel: selectedRow.channel,
          }}
          messages={toThreadMessageViews(thread, t)}
          t={t}
        />
      ) : (
        <EmptyThread filtered={Boolean(accountId)} t={t} />
      )}
    </InboxPanels>
  )
}

async function ComentariosMode({
  scope,
  accountId,
  mediaParam,
  hasInstagram,
  panel,
  t,
}: {
  scope: ConnectionScope
  accountId: string | undefined
  mediaParam: string | undefined
  hasInstagram: boolean
  panel: PanelProps
  t: AppDict
}) {
  // Sin cuenta de Instagram no hay hueco que llenar: es el único vacío
  // accionable de la pantalla, así que ocupa el ancho entero y lleva CTA en
  // vez de dibujar dos columnas con las dos mitades vacías. Conserva el panel
  // de lista para que las píldoras sigan dejando volver a Mensajes.
  if (!hasInstagram) {
    return (
      <InboxPanels>
        <InboxListPanel {...panel} count={0}>
          <p className="px-4 py-5 text-[13px] text-muted-foreground">
            {t.inbox.emptyComments}
          </p>
        </InboxListPanel>
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
    )
  }

  const publications = await listPublicationReadModel({
    scope,
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
        scope,
        connectedPageId: selected.connectedPageId,
        mediaId: selected.mediaId,
      })
    : []

  // Ni el permalink ni el caption vienen en el webhook de comentarios; mismo
  // trato que el @handle del contacto en mensajes.
  const media = await resolveMedia(scope, publications)

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
    <InboxPanels>
      <InboxListPanel {...panel} count={rows.length}>
        <PublicationLogList
          rows={rows}
          selectedKey={selectedRow?.key ?? null}
          selectedAccountId={accountId ?? null}
          t={t}
        />
      </InboxListPanel>
      {selectedRow ? (
        <CommentThread
          header={{
            mediaLabel: selectedRow.mediaLabel,
            mediaNoun: selectedRow.mediaNoun,
            mediaPermalink: selectedRow.mediaPermalink,
            accountHandle: selectedRow.accountHandle,
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
    </InboxPanels>
  )
}

/**
 * Dos columnas con scroll propio, a sangre completa bajo el header de consola
 * (mock `1h`/`1i`, ADR 0018): sin tarjeta ni padding de página. La caja llena
 * lo que queda del `main` —el layout ya es una columna flex con `min-h-0`—, y
 * cada panel hace su propio scroll. Vive una sola vez porque los dos modos
 * comparten la misma caja.
 */
function InboxPanels({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
}
