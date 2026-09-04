import { redirect } from "next/navigation"

import { getSession, signOut } from "@/lib/auth/session"
import { PostHogIdentify } from "@/components/posthog-identify"
import {
  QuotaNoticeBar,
  type QuotaNoticeView,
} from "@/features/billing/ui/quota-notice-bar"
import { AppSidebar } from "@/features/shell/ui/app-sidebar"
import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { HeaderActionsProvider } from "@/features/shell/ui/header-actions"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { AppI18nProvider } from "@/content/i18n/app/provider"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import type { TenantEntitlement } from "@/lib/billing/entitlements"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { privatePageMetadata } from "@/lib/seo"

// La app logueada no tiene nada que hacer en el índice. Lo heredan
// /connections, /inbox y /settings.
export const metadata = privatePageMetadata("Resender")

export default async function ProductLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession()
  if (!session?.user?.id) redirect("/login")
  // El idioma se resuelve una sola vez por petición y baja por contexto: los
  // componentes cliente del shell (el sidebar) y de cada pantalla lo leen de
  // ahí en vez de recibirlo enhebrado por props.
  const { lang, t } = await getAppI18n()
  // Sesión firmada que apunta a un usuario inexistente: la credencial es
  // basura y solo se arregla autenticándose de nuevo. `/login` no rebota de
  // vuelta porque comprueba lo mismo antes de mandar al producto.
  const access = await resolveProductAccess(session.user.id)
  if (access === "unknown_user") redirect("/login")
  if (access === "waitlisted") redirect("/pending")
  if (!(await hasActiveSubscription(session.user.id))) redirect("/billing")

  // El aviso no debe poder tirar el dashboard: si el entitlement no se puede
  // resolver, la barra simplemente no aparece (los gates del hot path siguen
  // siendo fail-closed por su cuenta).
  let notice: QuotaNoticeView | null = null
  try {
    notice = toQuotaNoticeView(await getTenantEntitlement(session.user.id))
  } catch (error) {
    console.error("quota notice unavailable", error)
  }

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/" })
  }

  return (
    // Shell de la consola (ADR 0015): bloque `Sidebar` de shadcn fijo a 232 px
    // y `SidebarInset` con header → barra de cuota → contenido. El sidebar no
    // colapsa (`collapsible="none"`), así que el provider solo aporta el ancho.
    <AppI18nProvider lang={lang} dict={t}>
      <PostHogIdentify
        distinctId={session.user.id}
        email={session.user.email}
      />
      <TooltipProvider>
        <HeaderActionsProvider>
          <SidebarProvider
            className="h-svh min-h-0 overflow-hidden bg-[var(--surface-app)]"
            style={{ "--sidebar-width": "232px" } as React.CSSProperties}
          >
            <AppSidebar
              name={session.user.name}
              email={session.user.email}
              signOutAction={signOutAction}
            />
            <SidebarInset className="min-w-0 overflow-y-auto">
              <ConsoleHeader />
              {/* La franja de cuota va bajo el header, al ancho de la columna. */}
              <QuotaNoticeBar notice={notice} t={t} />
              {/* PADDING DEL LAYOUT: 24px por lado. Cada pantalla dibuja su
                  cabecera y su cuerpo sin repetir estos paddings. */}
              <div className="px-6 py-6">{children}</div>
            </SidebarInset>
          </SidebarProvider>
        </HeaderActionsProvider>
      </TooltipProvider>
    </AppI18nProvider>
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
