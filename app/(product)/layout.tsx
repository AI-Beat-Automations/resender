import { redirect } from "next/navigation"

import { getSession, signOut } from "@/lib/auth/session"
import { PostHogIdentify } from "@/components/posthog-identify"
import {
  QuotaNoticeBar,
  type QuotaNoticeView,
} from "@/features/billing/ui/quota-notice-bar"
import { ClientRestrictedScreen } from "@/features/clients/ui/client-restricted-screen"
import { AppSidebar } from "@/features/shell/ui/app-sidebar"
import { AppI18nProvider } from "@/content/i18n/app/provider"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import type { TenantEntitlement } from "@/lib/billing/entitlements"
import { needsEmailVerification } from "@/lib/billing/free-plan-gate"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { isClientActor } from "@/lib/clients/actor"
import { getClientOwner, ownerDisplayName } from "@/lib/clients/client-owner"
import {
  resolveActorCached,
  resolveClientPlanCached,
} from "@/features/clients/queries"
import { privatePageMetadata } from "@/lib/seo"

// La app logueada no tiene nada que hacer en el índice. Lo heredan
// /connections, /inbox y /settings.
export const metadata = privatePageMetadata("Resender")

export default async function ProductLayout({
  children,
  header,
}: Readonly<{
  children: React.ReactNode
  /** Slot paralelo `@header`: breadcrumb y acciones de cada ruta. */
  header: React.ReactNode
}>) {
  const session = await getSession()
  if (!session?.user?.id) redirect("/login")
  // El idioma se resuelve una sola vez por petición y baja por contexto: los
  // componentes cliente del shell (el sidebar) y de cada pantalla lo leen de
  // ahí en vez de recibirlo enhebrado por props.
  const { lang, t } = await getAppI18n()

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/" })
  }

  // Sesión → actor → gates → render (issue #154). El actor se lee vivo de la
  // base, nunca de la sesión: es lo que decide de quién es lo que se ve.
  // Sesión firmada que apunta a un usuario inexistente: la credencial es
  // basura y solo se arregla autenticándose de nuevo. `/login` no rebota de
  // vuelta porque comprueba lo mismo antes de mandar al producto.
  const resolution = await resolveActorCached(session.user.id)
  if (resolution.kind === "unknown_user") redirect("/login")

  // Un user con fila de cliente que todavía no está activa: no tiene a dónde
  // ir. No es `/pending` (esa es la lista de espera, y lo rebotaría) ni
  // `/billing` (no paga): se le explica y se le deja cerrar sesión.
  if (resolution.kind === "client_pending") {
    return (
      <ClientRestrictedScreen
        lang={lang}
        t={t}
        user={session.user}
        ownerName={null}
        signOutAction={signOutAction}
      />
    )
  }

  const { actor } = resolution
  const isClient = isClientActor(actor)

  if (isClient) {
    // El cliente salta la lista de espera —su acceso lo decidió el padre al
    // invitarlo— y su gate de suscripción es el del padre. Sin suscripción
    // activa ve la cuenta restringida **sin CTA de pago** y nunca `/billing`.
    if (!(await hasActiveSubscription(actor.tenantId))) {
      const owner = await getClientOwner(actor.tenantId)
      return (
        <ClientRestrictedScreen
          lang={lang}
          t={t}
          user={session.user}
          ownerName={owner ? ownerDisplayName(owner) : null}
          signOutAction={signOutAction}
        />
      )
    }
  } else {
    const access = await resolveProductAccess(actor.userId)
    if (access === "waitlisted") redirect("/pending")
    // Sin muro de pago (ADR 0022): quien no paga está en el plan Free. Lo
    // único que se le pide es el correo confirmado, y `/pending` es donde se
    // le pide.
    if (await needsEmailVerification(actor.userId)) redirect("/pending")
  }

  // El aviso no debe poder tirar el dashboard: si el entitlement no se puede
  // resolver, la barra simplemente no aparece (los gates del hot path siguen
  // siendo fail-closed por su cuenta). Para un cliente no se monta: la cuota
  // es del padre y él nunca ve nada de facturación.
  let notice: QuotaNoticeView | null = null
  if (!isClient) {
    try {
      notice = toQuotaNoticeView(await getTenantEntitlement(actor.tenantId))
    } catch (error) {
      console.error("quota notice unavailable", error)
    }
  }

  // «Clientes» en el sidebar solo para Pro y Business (issue #154), y nunca
  // para un cliente. Como el aviso de cuota: si el plan no se puede resolver,
  // el item no aparece y la ruta `/clientes` sigue cerrada por su cuenta.
  let showClients = false
  if (!isClient) {
    try {
      showClients = (await resolveClientPlanCached(actor.tenantId)).canManage
    } catch (error) {
      console.error("client plan unavailable", error)
    }
  }

  return (
    // Shell de dos columnas (ADR 0005): sidebar fijo, contenido con scroll
    // propio. El dashboard va sobre `--surface-app`, sin textura.
    <div className="flex h-svh overflow-hidden bg-[var(--surface-app)]">
      <AppI18nProvider lang={lang} dict={t}>
        <PostHogIdentify
          distinctId={session.user.id}
          email={session.user.email}
        />
        <AppSidebar
          name={session.user.name}
          email={session.user.email}
          showClients={showClients}
          isClient={isClient}
          signOutAction={signOutAction}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Header de 52px (mock `1e`): breadcrumb + acciones de la ruta. */}
          {header}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {/* La franja de cuota va debajo del header, al ancho de la columna. */}
            <QuotaNoticeBar notice={notice} t={t} />
            {/* El padding de página lo pone cada pantalla con `ConsolePage`:
              Inbox va a sangre completa (ADR 0018) y el resto lo pide. */}
            {children}
          </div>
        </main>
      </AppI18nProvider>
    </div>
  )
}

function toQuotaNoticeView(
  entitlement: TenantEntitlement
): QuotaNoticeView | null {
  const { notice, block, limits, activePageCount } = entitlement
  if (notice.level === "none") return null

  return {
    level: notice.level,
    usage: notice.usage,
    limit: notice.limit,
    blockCode: block?.code ?? null,
    activePageCount,
    maxPages: limits?.maxPages ?? null,
  }
}
