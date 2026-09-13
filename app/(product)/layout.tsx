import { redirect } from "next/navigation"

import { getSession, signOut } from "@/lib/auth/session"
import { PostHogIdentify } from "@/components/posthog-identify"
import {
  QuotaNoticeBar,
  type QuotaNoticeView,
} from "@/features/billing/ui/quota-notice-bar"
import { AppSidebar } from "@/features/shell/ui/app-sidebar"
import { AppI18nProvider } from "@/content/i18n/app/provider"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { getActorCached } from "@/features/shell/queries"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import type { TenantEntitlement } from "@/lib/billing/entitlements"
import { hasActiveSubscription } from "@/lib/billing/subscription"
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
  const resolution = await getActorCached()
  // El idioma se resuelve una sola vez por petición y baja por contexto: los
  // componentes cliente del shell (el sidebar) y de cada pantalla lo leen de
  // ahí en vez de recibirlo enhebrado por props.
  const { lang, t } = await getAppI18n()
  // Sesión firmada que apunta a un usuario inexistente: la credencial es
  // basura y solo se arregla autenticándose de nuevo. `/login` no rebota de
  // vuelta porque comprueba lo mismo antes de mandar al producto.
  //
  // El actor (ADR 0020) separa a la persona del tenant: el gate de acceso mira
  // a la persona, y la suscripción, al tenant que paga. Para el dueño son el
  // mismo uuid; para la persona de un cliente de agencia, el tenant es la
  // agencia.
  if (!resolution || resolution.status === "unknown_user") redirect("/login")
  if (resolution.status === "waitlisted") redirect("/pending")
  if (resolution.status === "agency_unavailable") redirect("/access")
  const { actor } = resolution
  if (!(await hasActiveSubscription(actor.tenantId))) {
    redirect(actor.kind === "owner" ? "/billing" : "/access")
  }

  // El aviso no debe poder tirar el dashboard: si el entitlement no se puede
  // resolver, la barra simplemente no aparece (los gates del hot path siguen
  // siendo fail-closed por su cuenta).
  let notice: QuotaNoticeView | null = null
  try {
    notice = toQuotaNoticeView(await getTenantEntitlement(actor.tenantId))
  } catch (error) {
    console.error("quota notice unavailable", error)
  }

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/" })
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
