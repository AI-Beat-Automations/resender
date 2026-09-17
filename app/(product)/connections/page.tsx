import Link from "next/link"
import { Check, TriangleAlert, X } from "lucide-react"

import {
  ConnectedPageCard,
  type ConnectedPageView,
} from "@/features/connections/ui/connected-page-card"
import { ConnectionsEmptyState } from "@/features/connections/ui/empty-state"
import { ConsolePage } from "@/features/shell/ui/console-page"
import {
  listTenantPagesCached,
  resolveChannelAccessCached,
} from "@/features/connections/queries"
import { getSession } from "@/lib/auth/session"
import type { ChannelAccess } from "@/lib/auth/channel-access"
import { clientFilterOptions } from "@/features/clients/client-filter-options"
import {
  listClientNamesCached,
  resolveActorCached,
} from "@/features/clients/queries"
import { ClientFilterCombobox } from "@/features/clients/ui/client-filter-combobox"
import { connectionsHref } from "@/features/connections/connections-href"
import {
  CLIENT_FILTER_PARAM,
  clientFilterParam,
  resolveClientFilter,
} from "@/lib/clients/client-filter"
import {
  formatClientConnectRejection,
  formatClientLimitNotice,
  isClientLimitReason,
  type ClientLimitNotice,
} from "@/lib/clients/client-limits"
import { getClientLimits } from "@/lib/clients/client-limits-status"

// Sin sesión no hay permisos que leer y la pantalla no ofrece ningún canal
// cerrado. Messenger queda en `true` porque no tiene bandera: lo que decide si
// se ve es la sesión, y de eso ya se ocupa el layout.
const CLOSED_CHANNEL_ACCESS: ChannelAccess = {
  messenger: true,
  instagram: false,
  whatsapp: false,
}
import { fmt, type AppDict } from "@/content/i18n/app"
import { getAppDict } from "@/lib/i18n/app-dict"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { offersChannel } from "@/lib/pages/channel-display"
import { formatMetaConnectionError } from "@/lib/pages/meta-connection-error"
import { formatRelativeTime } from "@/lib/inbox/log-format"
import { listTenantPages } from "@/lib/pages/page-registry"
import { Alert, AlertContent } from "@/components/ui/alert"

type ConnectedPage = { id: string; name: string }

// Cupo de páginas del plan. `null` = no se pudo resolver: fail-closed, se
// muestra el bloqueo y no un «N de ?» inventado (ADR 0005). Para un cliente
// (issue #154) el contador es `conectadas / tope` y `suffix` lo dice.
type PageQuotaView = {
  activePageCount: number
  maxPages: number
  suffix?: string
} | null

// Lo que la pantalla necesita del cliente: su lista filtrada, su contador y su
// aviso (proximidad, tope propio o límite del padre), que nombra al padre y
// nunca habla de planes. El padre no tiene nada de esto: su aviso es el de
// cuota, que monta el layout.
type ClientView = {
  quota: PageQuotaView
  notice: ClientLimitNotice | null
  ownerName: string | null
}

// El formato de fecha depende del idioma, así que ya no puede ser un módulo
// suelto: se construye por petición con el `intl` del diccionario.
function dateTimeFormatFor(intl: string) {
  return new Intl.DateTimeFormat(intl, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    meta?: string
    pages?: string
    reason?: string
    instagram?: string
    username?: string
    [CLIENT_FILTER_PARAM]?: string | string[]
  }>
}) {
  const {
    meta,
    pages,
    reason,
    instagram,
    username,
    [CLIENT_FILTER_PARAM]: clientParam,
  } = await searchParams
  const t = await getAppDict()
  const connected = parseConnectedPages(pages)
  const session = await getSession()
  // Sesión → actor (issue #154): el cliente ve solo sus filas del tenant del
  // padre. Sin actor no hay nada que listar; el layout ya rebotó.
  const resolution = session?.user?.id
    ? await resolveActorCached(session.user.id)
    : null
  const actor = resolution?.kind === "actor" ? resolution.actor : null
  const tenantId = actor?.tenantId ?? null
  const clientAccountId = actor?.clientAccountId ?? null
  // Filtro por cliente del padre (ticket 4), validado contra sus clientes;
  // para un cliente no hay lista y el parámetro no hace nada. Va a la
  // consulta, encima del alcance del actor.
  const clients =
    actor && !clientAccountId ? await listClientNamesCached(actor.tenantId) : []
  const clientFilter = resolveClientFilter(clientParam, clients, {
    clientAccountId,
  })
  const clientFilterValue = clientFilterParam(clientFilter)
  const clientNames = new Map(clients.map((client) => [client.id, client.name]))
  // Sin filtro es la misma llamada que el header, para que el caché de
  // petición la deduplique; con filtro el header sigue leyendo la lista entera
  // —sus «Conectar…» dependen de si hay conexiones, no de la vista filtrada—.
  const tenantPages = !tenantId
    ? []
    : clientFilter.kind === "all"
      ? await listTenantPagesCached(tenantId, clientAccountId)
      : await listTenantPages(tenantId, clientAccountId, clientFilter)
  const clientView =
    tenantId && clientAccountId
      ? await resolveClientView(tenantId, clientAccountId, t)
      : null
  const quota = clientView
    ? clientView.quota
    : tenantId
      ? await resolvePageQuota(tenantId)
      : null
  // Permiso por canal del tenant (ADR 0010). Sin sesión no hay a quién
  // preguntarle, así que se cierran los dos. Se resuelven de una sola consulta
  // porque la pantalla los necesita juntos.
  const access = tenantId
    ? await resolveChannelAccessCached(tenantId)
    : CLOSED_CHANNEL_ACCESS
  const offersInstagram = offersChannel("instagram", access)
  const offersWhatsapp = offersChannel("whatsapp", access)

  const sortedPages = [...tenantPages].sort(
    (left, right) => cardRank(left) - cardRank(right)
  )
  const firstActiveId = sortedPages.find((page) => page.status === "active")?.id
  // El filtro solo se monta para un padre con clientes: sin clientes «Todos»
  // y «Mis conexiones» dicen lo mismo.
  const filterOptions =
    clients.length > 0
      ? clientFilterOptions(
          clients,
          (value) => connectionsHref({ clientFilter: value }),
          t
        )
      : null

  return (
    // Mock `1e`/`1f` con 20px de ritmo vertical, pero sin la columna de 880px
    // del mock: la lista va de padding a padding para no dejar media pantalla
    // vacía a la derecha. El padding de página lo aporta `ConsolePage`; los
    // «Conectar…» viven en el header (slot `@header`) cuando hay cuentas.
    <ConsolePage className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">
            {t.connections.title}
          </h1>
          <p className="mt-1.5 max-w-[600px] text-sm/[1.55] text-muted-foreground">
            {t.connections.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {filterOptions && (
            <ClientFilterCombobox
              options={filterOptions}
              selectedId={clientFilterValue}
            />
          )}
          {(tenantPages.length > 0 || clientFilter.kind !== "all") && (
            <PageQuota quota={quota} t={t} />
          )}
        </div>
      </header>

      {meta === "connected" && (
        <ConnectedNotice
          message={formatConnectedSummary(connected, t)}
          dismissLabel={t.common.dismissNotice}
        />
      )}

      {/* Instagram conecta una sola cuenta por autorización, así que el aviso
          la nombra por su @handle en vez de listar lo que quedó conectado. */}
      {instagram === "connected" && (
        <ConnectedNotice
          message={
            username
              ? fmt(t.connections.noticeInstagramNamed, { username })
              : t.connections.noticeInstagram
          }
          dismissLabel={t.common.dismissNotice}
        />
      )}

      {/* Los dos canales comparten el catálogo de motivos: el mismo problema
          se redacta igual, llegue por el callback de Facebook o el de
          Instagram. */}
      {(meta === "error" || instagram === "error") && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertContent>
            {/* El rebote por cupo de un cliente trae el veredicto como
                motivo: se redacta acá, con el nombre del padre, que el
                catálogo de `metaErrors` no tiene. */}
            {clientView && isClientLimitReason(reason)
              ? formatClientConnectRejection(reason, clientView.ownerName, t)
              : formatMetaConnectionError(reason, t)}
          </AlertContent>
        </Alert>
      )}

      {/* El aviso del cliente (issue #154): proximidad al tope en ámbar; tope
          propio o límite global del padre en rojo. Siempre nombra al padre. */}
      {clientView?.notice && (
        <Alert
          variant={
            clientView.notice.level === "blocked" ? "destructive" : "warning"
          }
        >
          <TriangleAlert />
          <AlertContent>
            <span className="font-medium">{clientView.notice.title}</span>{" "}
            {clientView.notice.body}
          </AlertContent>
        </Alert>
      )}

      {/* Dos vacíos distintos: sin conexiones (con los CTA por canal) vs. el
          filtro por cliente no devolvió ninguna. */}
      {tenantPages.length === 0 ? (
        clientFilter.kind === "all" ? (
          <ConnectionsEmptyState
            offersInstagram={offersInstagram}
            offersWhatsapp={offersWhatsapp}
            t={t}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.connections.emptyFiltered}
          </p>
        )
      ) : (
        sortedPages.map((page) => (
          <ConnectedPageCard
            key={page.id}
            page={toPageView(
              page,
              access,
              t,
              // Solo el padre etiqueta: para el cliente todo es suyo.
              page.clientAccountId
                ? (clientNames.get(page.clientAccountId) ?? null)
                : null
            )}
            showWebhookHint={page.id === firstActiveId}
            // El webhook es del padre: la tarjeta del cliente no lo dibuja.
            showWebhook={!clientView}
          />
        ))
      )}
    </ConsolePage>
  )
}

// Aviso verde del mock `1e`, descartable: la X vuelve a `/connections` limpio.
function ConnectedNotice({
  message,
  dismissLabel,
}: {
  message: string
  dismissLabel: string
}) {
  return (
    <Alert variant="success" className="items-center py-2.5">
      <Check strokeWidth={2.2} />
      <AlertContent>{message}</AlertContent>
      <Link
        href="/connections"
        aria-label={dismissLabel}
        className="shrink-0 opacity-60 hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </Link>
    </Alert>
  )
}

// El cupo del plan cuenta **conexiones**, sin mirar el canal (ADR 0011): una
// cuenta de Instagram ocupa slot igual que una Página de Facebook. El contador
// dice «conexiones» y no «páginas» justamente para que nadie busque por qué su
// cuenta de IG no suma —lo hace—.
function PageQuota({ quota, t }: { quota: PageQuotaView; t: AppDict }) {
  if (!quota) {
    return (
      <p className="shrink-0 font-mono text-[11px] text-[var(--danger-text)]">
        {t.connections.quotaUnresolved}
      </p>
    )
  }

  // Mock `1e`: «2 / 2» en mono y el sufijo en gris, alineado al pie del título.
  return (
    <p className="flex shrink-0 items-center gap-2 text-[12.5px] whitespace-nowrap text-muted-foreground">
      <span className="font-mono text-foreground">
        {quota.activePageCount} / {quota.maxPages}
      </span>
      {quota.suffix ?? t.connections.quotaActiveSuffix}
    </p>
  )
}

// El contador y el aviso del cliente salen de `client-limits`, no del
// entitlement del padre. Si no se puede leer, el contador queda sin resolver
// —como el del padre— y no hay aviso.
async function resolveClientView(
  tenantId: string,
  clientAccountId: string,
  t: AppDict
): Promise<ClientView> {
  try {
    const status = await getClientLimits({ tenantId, clientAccountId })
    if (!status.ok) return { quota: null, notice: null, ownerName: null }
    const { limits, ownerName } = status
    return {
      quota: {
        activePageCount: limits.clientActiveCount,
        maxPages: limits.clientMaxConnections ?? limits.planMaxPages,
        suffix: t.clientLimits.counterSuffix,
      },
      notice: formatClientLimitNotice(limits, ownerName, t),
      ownerName,
    }
  } catch (error) {
    console.error("client limits unavailable", error)
    return { quota: null, notice: null, ownerName: null }
  }
}

// Orden de la lista (spec B2): activa → con el token rechazado → desconectada.
function cardRank(page: Awaited<ReturnType<typeof listTenantPages>>[number]) {
  if (page.status !== "active") return 2
  return page.tokenStatus === "invalid" ? 1 : 0
}

// El cupo no cuesta una consulta nueva de dominio: reusa el entitlement que ya
// existe. Si el plan no se resuelve (o la lectura falla) devuelve null y la
// pantalla lo dice, en vez de dibujar un límite inventado (ADR 0005).
async function resolvePageQuota(tenantId: string): Promise<PageQuotaView> {
  try {
    const entitlement = await getTenantEntitlement(tenantId)
    if (!entitlement.limits) return null
    return {
      activePageCount: entitlement.activePageCount,
      maxPages: entitlement.limits.maxPages,
    }
  } catch (error) {
    console.error("page quota unavailable", error)
    return null
  }
}

function toPageView(
  page: Awaited<ReturnType<typeof listTenantPages>>[number],
  access: ChannelAccess,
  t: AppDict,
  clientName: string | null
): ConnectedPageView {
  const dateTimeFormat = dateTimeFormatFor(t.intl)
  const now = new Date()

  return {
    id: page.id,
    channel: page.channel,
    access,
    metaPageId: page.metaPageId,
    name: page.name,
    username: page.username,
    wabaId: page.wabaId,
    whatsappPhoneE164: page.whatsappPhoneE164,
    onboardingMode: page.onboardingMode,
    coexistenceStatus: page.coexistenceStatus,
    historySyncStatus: page.historySyncStatus,
    whatsappPinGenerated: page.whatsappPinGenerated,
    status: page.status,
    tokenStatus: page.tokenStatus,
    tokenError: page.tokenError,
    webhookUrl: page.webhookUrl,
    hasSigningSecret: page.hasSigningSecret,
    pausedAt: page.pausedAt?.toISOString() ?? null,
    pausedSinceLabel: page.pausedAt
      ? formatRelativeTime(page.pausedAt, now, t)
      : null,
    connectedAt: page.connectedAt.toISOString(),
    connectedAtLabel: dateTimeFormat.format(page.connectedAt),
    tokenErrorAt: page.tokenErrorAt?.toISOString() ?? null,
    tokenErrorAtLabel: page.tokenErrorAt
      ? dateTimeFormat.format(page.tokenErrorAt)
      : null,
    disconnectedAt: page.disconnectedAt?.toISOString() ?? null,
    disconnectedAtLabel: page.disconnectedAt
      ? dateTimeFormat.format(page.disconnectedAt)
      : null,
    clientName,
  }
}

function parseConnectedPages(pages?: string): ConnectedPage[] {
  if (!pages) return []

  try {
    const parsed = JSON.parse(pages) as ConnectedPage[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (page) => typeof page.id === "string" && typeof page.name === "string"
    )
  } catch {
    return []
  }
}

// Qué páginas quedaron autorizadas al volver de Meta, con su id: es la única
// confirmación que tiene el usuario de qué acaba de conectar.
function formatConnectedSummary(
  connected: ConnectedPage[],
  t: AppDict
): string {
  if (connected.length === 0) return t.connections.noticeConnectedGeneric

  const names = connected.map((page) => `${page.name} (${page.id})`)
  const list =
    names.length === 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} ${t.connections.listConjunction} ${
          names[names.length - 1] ?? ""
        }`

  return connected.length === 1
    ? fmt(t.connections.noticeConnectedOne, { list })
    : fmt(t.connections.noticeConnectedMany, {
        count: connected.length,
        list,
      })
}
