import Link from "next/link"
import {
  AtSign,
  Check,
  Link2,
  MessageCircle,
  TriangleAlert,
  X,
} from "lucide-react"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { ConnectInstagramButton } from "@/features/connect-meta/ui/connect-instagram-button"
import { ConnectWhatsAppButton } from "@/features/connect-whatsapp/ui/connect-whatsapp-button"
import {
  ConnectedPageCard,
  type ConnectedPageView,
} from "@/features/connections/ui/connected-page-card"
import { auth } from "@/auth"
import {
  resolveChannelAccess,
  type ChannelAccess,
} from "@/lib/auth/channel-access"

// Sin sesión no hay permisos que leer y la pantalla no ofrece ningún canal
// cerrado. Messenger queda en `true` porque no tiene bandera: lo que decide si
// se ve es la sesión, y de eso ya se ocupa el layout.
const CLOSED_CHANNEL_ACCESS: ChannelAccess = {
  messenger: true,
  instagram: false,
  whatsapp: false,
}
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { offersChannel } from "@/lib/pages/channel-display"
import { formatMetaConnectionError } from "@/lib/pages/meta-connection-error"
import { listTenantPages } from "@/lib/pages/page-registry"

type ConnectedPage = { id: string; name: string }

// Cupo de páginas del plan. `null` = no se pudo resolver: fail-closed, se
// muestra el bloqueo y no un «N de ?» inventado (ADR 0005).
type PageQuotaView = { activePageCount: number; maxPages: number } | null

const dateTimeFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

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
  const connected = parseConnectedPages(pages)
  const session = await auth()
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

  return (
    // El padding de página lo aporta el `main` del layout (spec C.7): acá solo
    // el ritmo vertical entre cabecera y cuerpo.
    <div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
            {"// conexiones"}
          </p>
          <h1 className="mt-1.5 font-heading text-[26px] font-bold tracking-[-0.02em]">
            Conexiones
          </h1>
          <p className="mt-2 max-w-[620px] text-[14.5px]/[1.6] text-muted-foreground">
            Conecta tus páginas de Facebook, tus cuentas de Instagram y tus
            números de WhatsApp, configura un webhook por cuenta y desconecta
            canales sin borrar el historial.
          </p>
        </div>
        {/* En el estado vacío los CTA viven en las tarjetas de abajo, no acá. */}
        {tenantPages.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2.5">
            <ConnectFacebookButton />
            {offersInstagram && <ConnectInstagramButton />}
            {offersWhatsapp && <ConnectWhatsAppButton />}
          </div>
        )}
      </header>

      <div className="mt-6 flex flex-col gap-3.5">
        {meta === "connected" && (
          <div className="flex items-center gap-3 rounded-lg border border-success-soft-border bg-success-soft px-4 py-3 text-success-soft-foreground">
            <Check className="size-4 shrink-0" aria-hidden />
            <p className="flex-1 text-[13.5px]">
              {formatConnectedSummary(connected)}
            </p>
            <Link
              href="/connections"
              aria-label="Descartar el aviso"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <X className="size-[15px]" aria-hidden />
            </Link>
          </div>
        )}

        {/* Instagram conecta una sola cuenta por autorización, así que el aviso
            la nombra por su @handle en vez de listar lo que quedó conectado. */}
        {instagram === "connected" && (
          <div className="flex items-center gap-3 rounded-lg border border-success-soft-border bg-success-soft px-4 py-3 text-success-soft-foreground">
            <Check className="size-4 shrink-0" aria-hidden />
            <p className="flex-1 text-[13.5px]">
              {username
                ? `Conectado: la cuenta de Instagram @${username} quedó autorizada.`
                : "Conectado: la cuenta de Instagram quedó autorizada."}
            </p>
            <Link
              href="/connections"
              aria-label="Descartar el aviso"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <X className="size-[15px]" aria-hidden />
            </Link>
          </div>
        )}

        {/* Los dos canales comparten el catálogo de motivos: el mismo problema
            se redacta igual, llegue por el callback de Facebook o el de
            Instagram. */}
        {(meta === "error" || instagram === "error") && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3.5 py-3 text-destructive-soft-foreground">
            <TriangleAlert
              className="mt-0.5 size-[15px] shrink-0"
              aria-hidden
            />
            <p className="flex-1 text-[13px]/[1.5]">
              {formatMetaConnectionError(reason)}
            </p>
          </div>
        )}

        {tenantPages.length === 0 ? (
          <EmptyState
            offersInstagram={offersInstagram}
            offersWhatsapp={offersWhatsapp}
          />
        ) : (
          <>
            <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
                CUENTAS CONECTADAS
              </h2>
              <PageQuota quota={quota} />
            </div>
            {sortedPages.map((page) => (
              <ConnectedPageCard
                key={page.id}
                page={toPageView(page, access)}
                showWebhookHint={page.id === firstActiveId}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// B1: qué va a pasar al conectar la primera cuenta, y el flujo en tres pasos.
// Una tarjeta por canal: cada uno tiene su propio diálogo de autorización en
// Meta, así que son dos caminos y no dos variantes del mismo botón.
// Sin permiso, Instagram no aparece acá: es la pantalla que ve una cuenta
// nueva, que es justo la población que nace sin el canal (ADR 0010).
function EmptyState({
  offersInstagram,
  offersWhatsapp,
}: {
  offersInstagram: boolean
  offersWhatsapp: boolean
}) {
  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)] sm:flex-row sm:items-center">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-primary"
          aria-hidden
        >
          <Link2 className="size-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-heading text-base font-semibold">Facebook</h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Autoriza tus páginas desde Meta para empezar a recibir mensajes.
          </p>
        </div>
        <ConnectFacebookButton />
      </section>

      {offersInstagram && (
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)] sm:flex-row sm:items-center">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-primary"
            aria-hidden
          >
            <AtSign className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-heading text-base font-semibold">Instagram</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              Autoriza tu cuenta profesional para recibir mensajes directos y
              comentarios. No necesitas una página de Facebook.
            </p>
          </div>
          <ConnectInstagramButton />
        </section>
      )}

      {offersWhatsapp && (
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)] sm:flex-row sm:items-center">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-primary"
            aria-hidden
          >
            <MessageCircle className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-heading text-base font-semibold">WhatsApp</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              Da de alta un número nuevo, o conecta el que ya usas en WhatsApp
              Business App sin dejar de usarlo desde el teléfono. Solo se puede
              responder dentro de las 24 horas posteriores al último mensaje del
              cliente.
            </p>
          </div>
          <ConnectWhatsAppButton />
        </section>
      )}

      <section className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border-strong bg-card p-10 text-center">
        <div className="max-w-[460px]">
          <h3 className="font-heading text-[19px] font-semibold tracking-[-0.02em]">
            Todavía no hay cuentas conectadas.
          </h3>
          <p className="mt-2 text-sm/[1.6] text-muted-foreground">
            Cuando autorices una cuenta aparecerá acá, con su webhook y su
            estado. Reconectar actualiza el token y los metadatos sin duplicar
            cuentas.
          </p>
        </div>
        <ol className="flex flex-wrap justify-center gap-x-[22px] gap-y-1.5 font-mono text-[11px] text-[var(--text-subtle)]">
          <li>1 · autorizas la cuenta</li>
          <li>2 · apuntas tu webhook</li>
          <li>3 · llega el primer mensaje</li>
        </ol>
      </section>
    </>
  )
}

/**
 * Los dos caminos de alta de WhatsApp. Son dos botones y no uno con un select
 * porque son dos flujos distintos en Meta —el estándar registra el número con
 * `/register`, el de Coexistence no lo toca nunca— y la elección no es
 * reversible: un número quemado en el estándar deja de ser candidato para
 * Coexistence.
 *
 * TODO: placeholders. El componente lanzador de `features/connect-whatsapp/`
 * los reemplaza en cuanto exista: el alta real es un Embedded Signup en un
 * popup con nonce y `session logging`, no una navegación suelta. Estos `<a>`
 * apuntan a las mismas rutas que va a usar el lanzador, así que el contrato de
 * URLs no cambia cuando llegue.
 */
// El cupo del plan cuenta **conexiones**, sin mirar el canal (ADR 0011): una
// cuenta de Instagram ocupa slot igual que una Página de Facebook. El contador
// dice «conexiones» y no «páginas» justamente para que nadie busque por qué su
// cuenta de IG no suma —lo hace—.
function PageQuota({ quota }: { quota: PageQuotaView }) {
  if (!quota) {
    return (
      <p className="font-mono text-[11px] text-[var(--danger-text)]">
        cupo sin resolver · escríbenos a info@resender.dev
      </p>
    )
  }

  return (
    <p className="font-mono text-[11px] text-muted-foreground">
      {quota.activePageCount} de {quota.maxPages} conexiones
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
  access: ChannelAccess
): ConnectedPageView {
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
function formatConnectedSummary(connected: ConnectedPage[]): string {
  if (connected.length === 0) return "Conectado: la autorización se completó."

  const names = connected.map((page) => `${page.name} (${page.id})`)
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`

  return `Conectado: ${connected.length} ${
    connected.length === 1 ? "página autorizada" : "páginas autorizadas"
  } — ${list}.`
}
