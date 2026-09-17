import Link from "next/link"
import type { ReactNode } from "react"
import { MessageSquare } from "lucide-react"

import { getSession } from "@/lib/auth/session"
import { clientFilterOptions } from "@/features/clients/client-filter-options"
import {
  listClientNamesCached,
  resolveActorCached,
} from "@/features/clients/queries"
import type { ClientFilterOption } from "@/features/clients/ui/client-filter-combobox"
import { CommentThread } from "@/features/comments/ui/comment-thread"
import { PublicationLogList } from "@/features/comments/ui/publication-log-list"
import { listTenantPagesCached } from "@/features/connections/queries"
import { EmptyPane } from "@/features/inbox/ui/empty-pane"
import type { InboxFilterAccount } from "@/features/inbox/ui/inbox-account-combobox"
import { InboxListPanel } from "@/features/inbox/ui/inbox-list-panel"
import { ConversationLogList } from "@/features/messages/ui/conversation-log-list"
import {
  EmptyThread,
  MessageThread,
} from "@/features/messages/ui/message-thread"
import type { Actor } from "@/lib/clients/actor"
import {
  CLIENT_FILTER_PARAM,
  clientFilterParam,
  matchesClientFilter,
  resolveClientFilter,
  type ClientFilter,
} from "@/lib/clients/client-filter"
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
  inboxHref,
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
  toThreadTimeline,
} from "@/lib/messages/display"
import {
  listConversationPauseEvents,
  listConversationReadModel,
  listThreadMessages,
} from "@/lib/messages/read-model"
import type { AppDict } from "@/content/i18n/app"
import { getAppDict } from "@/lib/i18n/app-dict"
import { Button } from "@/components/ui/button"

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[]
    [CLIENT_FILTER_PARAM]?: string | string[]
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
  // Sesión → actor (issue #154, ticket 4): el cliente ve solo las
  // conversaciones de sus conexiones; el padre, las suyas y las de sus
  // clientes. Sin actor no hay nada que listar; el layout ya rebotó.
  const resolution = session?.user?.id
    ? await resolveActorCached(session.user.id)
    : null
  if (resolution?.kind !== "actor") return null
  const { actor } = resolution
  const { tenantId, clientAccountId } = actor

  const tab = resolveInboxTab(params.tab)
  // Solo el padre tiene clientes que filtrar; para un cliente la lista queda
  // vacía y `resolveClientFilter` ignora el parámetro de todos modos.
  const clients = clientAccountId ? [] : await listClientNamesCached(tenantId)
  const clientFilter = resolveClientFilter(
    params[CLIENT_FILTER_PARAM],
    clients,
    actor
  )
  const clientFilterValue = clientFilterParam(clientFilter)
  const clientNames = new Map(clients.map((client) => [client.id, client.name]))

  // Las cuentas ya vienen con el alcance del actor; misma llamada que
  // Conexiones para que el caché de petición la deduplique.
  const accounts = await listTenantPagesCached(tenantId, clientAccountId)
  // En comentarios el filtro solo lista Instagram: los comentarios no existen
  // en Messenger, y una píldora que siempre devuelve cero es un control muerto.
  // Filtrar acá además invalida solo el `?page=` de una cuenta de Messenger al
  // cambiar de modo, sin tener que limpiarlo aparte. El filtro por cliente
  // hace lo mismo con el `?page=` de una cuenta de otro cliente.
  const filterable = accounts.filter(
    (account) =>
      (tab !== "comentarios" || account.channel === "instagram") &&
      matchesClientFilter(clientFilter, account.clientAccountId)
  )
  const accountParam = firstParam(params.page)
  const accountId = filterable.some((account) => account.id === accountParam)
    ? accountParam
    : undefined
  // El desplegable nombra la cuenta como la fila: @handle, número o nombre.
  const filterAccounts: InboxFilterAccount[] = filterable.map((account) => ({
    id: account.id,
    label: formatAccountShortLabel(account),
  }))
  // El filtro por cliente solo se monta para un padre con clientes: para un
  // cliente no hay a quién filtrar, y sin clientes «Todos» y «Mis conexiones»
  // dicen lo mismo. Cambiar de cliente suelta la cuenta y la selección: lo
  // más probable es que ya no pertenezcan al cliente nuevo.
  const clientFilterOptionsForTab: ClientFilterOption[] | null =
    clients.length > 0
      ? clientFilterOptions(
          clients,
          (value) => inboxHref({ tab, clientFilter: value }),
          t
        )
      : null
  const panel = {
    tab,
    accounts: filterAccounts,
    selectedAccountId: accountId ?? null,
    clientFilter: clientFilterOptionsForTab
      ? { options: clientFilterOptionsForTab, selectedId: clientFilterValue }
      : null,
    t,
  }
  const scope = {
    actor,
    accountId,
    clientFilter,
    clientFilterValue,
    clientNames,
  }

  return tab === "comentarios" ? (
    <ComentariosMode
      scope={scope}
      mediaParam={firstParam(params.media)}
      // Lo decide lo que el actor tiene, no el filtro por cliente: si el
      // cliente elegido no tiene Instagram, el vacío es el del filtro y no el
      // CTA de conectar una cuenta.
      hasInstagram={accounts.some((account) => account.channel === "instagram")}
      panel={panel}
      t={t}
    />
  ) : (
    <MensajesMode
      scope={scope}
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
  clientFilter: {
    options: ClientFilterOption[]
    selectedId: string | null
  } | null
  t: AppDict
}

// Quién mira y qué filtros trae la URL, ya validados. Los read models reciben
// el actor (alcance) y el filtro por cliente y los aplican en la consulta.
type InboxScope = {
  actor: Actor
  accountId: string | undefined
  clientFilter: ClientFilter
  clientFilterValue: string | null
  /** `client_account_id` → nombre, para etiquetar las filas del padre. */
  clientNames: Map<string, string>
}

// Qué vacío pintar cuando no hay filas: sin datos, o uno de los dos filtros
// no devolvió nada. El de cuenta manda si están los dos puestos.
type EmptyKind = "none" | "account" | "client"

function emptyKind(scope: InboxScope): EmptyKind {
  if (scope.accountId) return "account"
  return scope.clientFilter.kind !== "all" ? "client" : "none"
}

function clientNameFor(scope: InboxScope, clientAccountId: string | null) {
  return clientAccountId
    ? (scope.clientNames.get(clientAccountId) ?? null)
    : null
}

async function MensajesMode({
  scope,
  conversationParam,
  panel,
  t,
}: {
  scope: InboxScope
  conversationParam: string | undefined
  panel: PanelProps
  t: AppDict
}) {
  const { tenantId, clientAccountId } = scope.actor
  const conversations = await listConversationReadModel({
    tenantId,
    clientAccountId,
    clientFilter: scope.clientFilter,
    connectedPageId: scope.accountId,
  })
  // Al entrar a Inbox se abre la conversación más reciente: el read model ya
  // viene ordenado por `last_message_at desc`. La selección se valida contra
  // la lista, que ya trae el alcance del actor: un `?conversation=` de otra
  // conexión del tenant no se abre para un cliente ni por URL.
  const selectedConversation =
    conversations.find(
      (conversation) => conversation.id === conversationParam
    ) ??
    conversations[0] ??
    null
  // Los eventos de pausa (ADR 0021) se leen aparte y se intercalan en la
  // vista: son otra tabla y otra forma, y el hilo los ordena por instante.
  const [thread, pauseEvents] = selectedConversation
    ? await Promise.all([
        listThreadMessages({
          tenantId,
          clientAccountId,
          conversationId: selectedConversation.id,
        }),
        listConversationPauseEvents({
          tenantId,
          clientAccountId,
          conversationId: selectedConversation.id,
        }),
      ])
    : [[], []]

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
      t,
      clientNameFor(scope, conversation.page.clientAccountId)
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
          selectedAccountId={scope.accountId ?? null}
          clientFilter={scope.clientFilterValue}
          t={t}
        />
      </InboxListPanel>
      {selectedRow && selectedConversation ? (
        <MessageThread
          header={{
            conversationId: selectedConversation.id,
            contactLabel: selectedRow.contactLabel,
            accountLabel: selectedRow.accountLabel,
            channel: selectedRow.channel,
            pausedAt: selectedConversation.pausedAt?.toISOString() ?? null,
            clientName: selectedRow.clientName,
          }}
          entries={toThreadTimeline(thread, pauseEvents, t, now)}
          t={t}
        />
      ) : (
        <EmptyThread filtered={emptyKind(scope)} t={t} />
      )}
    </InboxPanels>
  )
}

async function ComentariosMode({
  scope,
  mediaParam,
  hasInstagram,
  panel,
  t,
}: {
  scope: InboxScope
  mediaParam: string | undefined
  hasInstagram: boolean
  panel: PanelProps
  t: AppDict
}) {
  const { tenantId, clientAccountId } = scope.actor
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
    tenantId,
    clientAccountId,
    clientFilter: scope.clientFilter,
    connectedPageId: scope.accountId,
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
        clientAccountId,
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
      media.get(mediaKey(publication.connectedPageId, publication.mediaId)),
      clientNameFor(scope, publication.account.clientAccountId)
    )
  )
  const selectedRow =
    rows.find(
      (row) => row.key === (selected && formatPublicationKey(selected))
    ) ?? null

  const filtered = emptyKind(scope)

  return (
    <InboxPanels>
      <InboxListPanel {...panel} count={rows.length}>
        <PublicationLogList
          rows={rows}
          selectedKey={selectedRow?.key ?? null}
          selectedAccountId={scope.accountId ?? null}
          clientFilter={scope.clientFilterValue}
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
            clientName: selectedRow.clientName,
          }}
          comments={toCommentBubbleViews(thread, t)}
          t={t}
        />
      ) : (
        <EmptyPane
          icon={MessageSquare}
          title={
            filtered === "account"
              ? t.inbox.noCommentsFilteredTitle
              : filtered === "client"
                ? t.inbox.noCommentsClientFilteredTitle
                : t.inbox.noCommentsTitle
          }
          body={
            filtered === "account"
              ? t.inbox.noCommentsFilteredBody
              : filtered === "client"
                ? t.inbox.noCommentsClientFilteredBody
                : t.inbox.noCommentsBody
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
