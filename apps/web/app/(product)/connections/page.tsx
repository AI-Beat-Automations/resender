import Link from "next/link"
import { Check, TriangleAlert, X } from "lucide-react"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { ConnectInstagramButton } from "@/features/connect-meta/ui/connect-instagram-button"
import { ConnectWhatsAppButton } from "@/features/connect-whatsapp/ui/connect-whatsapp-button"
import { ChannelAvatar } from "@/features/connections/ui/channel-avatar"
import {
  ConnectedPageCard,
  type ConnectedPageView,
} from "@/features/connections/ui/connected-page-card"
import { EmptyState } from "@/features/shell/ui/empty-state"
import { HeaderActions } from "@/features/shell/ui/header-actions"
import { getSession } from "@/lib/auth/session"
import {
  resolveChannelAccess,
  type ChannelAccess,
} from "@/lib/auth/channel-access"
import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

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
import { listTenantPages } from "@/lib/pages/page-registry"

type ConnectedPage = { id: string; name: string }

// Cupo de páginas del plan. `null` = no se pudo resolver: fail-closed, se
// muestra el bloqueo y no un «N de ?» inventado (ADR 0005).
type PageQuotaView = { activePageCount: number; maxPages: number } | null

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
  }>
}) {
  const { meta, pages, reason, instagram, username } = await searchParams
  const t = await getAppDict()
  const connected = parseConnectedPages(pages)
  const session = await getSession()
  const tenantId = session?.user?.id ?? null
  const tenantPages = tenantId ? await listTenantPages(tenantId) : []
  const quota = tenantId ? await resolvePageQuota(tenantId) : null
  // Permiso por canal del tenant (ADR 0010). Sin sesión no hay a quién
  // preguntarle, así que se cierran los dos. Se resuelven de una sola consulta
  // porque la pantalla los necesita juntos.
  const access = tenantId
    ? await resolveChannelAccess(tenantId)
    : CLOSED_CHANNEL_ACCESS
  const offersInstagram = offersChannel("instagram", access)
  const offersWhatsapp = offersChannel("whatsapp", access)

  const sortedPages = [...tenantPages].sort(
    (left, right) => cardRank(left) - cardRank(right)
  )
  const firstActiveId = sortedPages.find((page) => page.status === "active")?.id
  const hasPages = tenantPages.length > 0

  return (
    // El padding de página lo aporta el `main` del layout (spec C.7): acá solo
    // el ritmo vertical. El ancho máximo es el del mock 1e.
    <div className="flex max-w-[880px] flex-col gap-5">
      {/* Los botones de conectar viven en el hueco del header (ADR 0015). En el
          estado vacío los CTA están en las tarjetas de abajo, y el launcher de
          WhatsApp no puede estar montado dos veces (nonce único por navegador),
          así que el hueco queda vacío. Los hijos son elementos de servidor:
          `HeaderActions` solo los publica en el contexto del header. */}
      {hasPages && (
        <HeaderActions>
          {offersInstagram && (
            <ConnectInstagramButton
              label={t.connections.connectInstagram}
              variant="outline"
              size="sm"
              icon
            />
          )}
          {offersWhatsapp && (
            <ConnectWhatsAppButton variant="outline" size="sm" icon compact />
          )}
          <ConnectFacebookButton
            label={t.connections.connectFacebook}
            variant="outline"
            size="sm"
            icon
          />
        </HeaderActions>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">
            {t.connections.title}
          </h1>
          <p className="mt-1.5 max-w-[600px] text-sm/[1.55] text-muted-foreground">
            {t.connections.subtitle}
          </p>
        </div>
        {/* El contador sustituye al botón deshabilitado por cupo (ADR 0005):
            los botones del header siguen activos y el cupo se lee acá. */}
        {hasPages && <PageQuota quota={quota} t={t} />}
      </header>

      {meta === "connected" && (
        <Alert variant="success" role="status" className="items-center">
          <Check aria-hidden />
          <AlertTitle className="font-normal">
            {formatConnectedSummary(connected, t)}
          </AlertTitle>
          <DismissNotice label={t.common.dismissNotice} />
        </Alert>
      )}

      {/* Instagram conecta una sola cuenta por autorización, así que el aviso
          la nombra por su @handle en vez de listar lo que quedó conectado. */}
      {instagram === "connected" && (
        <Alert variant="success" role="status" className="items-center">
          <Check aria-hidden />
          <AlertTitle className="font-normal">
            {username
              ? fmt(t.connections.noticeInstagramNamed, { username })
              : t.connections.noticeInstagram}
          </AlertTitle>
          <DismissNotice label={t.common.dismissNotice} />
        </Alert>
      )}

      {/* Los dos canales comparten el catálogo de motivos: el mismo problema
          se redacta igual, llegue por el callback de Facebook o el de
          Instagram. */}
      {(meta === "error" || instagram === "error") && (
        <Alert variant="destructive" role="alert">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">
            {formatMetaConnectionError(reason, t)}
          </AlertTitle>
        </Alert>
      )}

      {hasPages ? (
        <section className="flex flex-col gap-4">
          <h2 className="sr-only">{t.connections.connectedAccountsHeading}</h2>
          {sortedPages.map((page) => (
            <ConnectedPageCard
              key={page.id}
              page={toPageView(page, access, t)}
              showWebhookHint={page.id === firstActiveId}
            />
          ))}
        </section>
      ) : (
        <ConnectionsEmptyState
          offersInstagram={offersInstagram}
          offersWhatsapp={offersWhatsapp}
          t={t}
        />
      )}
    </div>
  )
}

// La X que limpia el aviso: vuelve a `/connections` sin los `searchParams`.
function DismissNotice({ label }: { label: string }) {
  return (
    <AlertAction className="top-1/2 -translate-y-1/2">
      <Link
        href="/connections"
        aria-label={label}
        className="flex size-6 items-center justify-center rounded-md opacity-60 hover:opacity-100"
      >
        <X className="size-[14px]" aria-hidden />
      </Link>
    </AlertAction>
  )
}

// B1 (mock 1f): una tarjeta por canal y, debajo, el panel punteado con los tres
// pasos. Cada canal tiene su propio diálogo de autorización en Meta, así que
// son caminos distintos y no variantes del mismo botón. Sin permiso, Instagram
// y WhatsApp no aparecen: es la pantalla que ve una cuenta nueva, que es justo
// la población que nace sin el canal (ADR 0010).
function ConnectionsEmptyState({
  offersInstagram,
  offersWhatsapp,
  t,
}: {
  offersInstagram: boolean
  offersWhatsapp: boolean
  t: AppDict
}) {
  return (
    <>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <ChannelCard
          channel="messenger"
          title={t.connections.empty.facebookTitle}
          body={t.connections.empty.facebookBody}
        >
          <ConnectFacebookButton
            label={t.connections.connectFacebook}
            variant="outline"
            size="default"
            className="w-full"
          />
        </ChannelCard>

        {offersInstagram && (
          <ChannelCard
            channel="instagram"
            title={t.connections.empty.instagramTitle}
            body={t.connections.empty.instagramBody}
          >
            <ConnectInstagramButton
              label={t.connections.connectInstagram}
              variant="outline"
              size="default"
              className="w-full"
            />
          </ChannelCard>
        )}

        {offersWhatsapp && (
          <ChannelCard
            channel="whatsapp"
            title={t.connections.empty.whatsappTitle}
            body={t.connections.empty.whatsappBody}
          >
            <ConnectWhatsAppButton variant="outline" size="default" />
          </ChannelCard>
        )}
      </div>

      <EmptyState
        title={t.connections.empty.title}
        body={t.connections.empty.body}
      >
        <ol className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
          {[
            t.connections.empty.step1,
            t.connections.empty.step2,
            t.connections.empty.step3,
          ].map((step) => (
            <li
              key={step}
              className="rounded-full border border-border bg-card px-3 py-1.5"
            >
              {step}
            </li>
          ))}
        </ol>
      </EmptyState>
    </>
  )
}

function ChannelCard({
  channel,
  title,
  body,
  children,
}: {
  channel: ConnectedPageView["channel"]
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <Card className="gap-3 [--card-spacing:--spacing(5)]">
      <CardHeader className="gap-3">
        <ChannelAvatar channel={channel} />
        <div>
          <CardTitle className="font-semibold">{title}</CardTitle>
          <CardDescription className="mt-1 text-[13px]/[1.5]">
            {body}
          </CardDescription>
        </div>
      </CardHeader>
      {/* El pie va sin fondo: en el mock el botón es parte de la misma
          superficie blanca. */}
      <CardFooter className="mt-auto border-0 bg-transparent pt-0">
        {children}
      </CardFooter>
    </Card>
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

  return (
    <p className="flex shrink-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground">
      <span className="font-medium text-foreground">
        {quota.activePageCount} / {quota.maxPages}
      </span>
      {t.connections.quotaActiveLabel}
    </p>
  )
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
  t: AppDict
): ConnectedPageView {
  const dateTimeFormat = dateTimeFormatFor(t.intl)

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
