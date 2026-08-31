import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"
import { PostHogIdentify } from "@/components/posthog-identify"
import {
  QuotaNoticeBar,
  type QuotaNoticeView,
} from "@/features/billing/ui/quota-notice-bar"
import { AppSidebar } from "@/features/shell/ui/app-sidebar"
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
  const session = await auth()
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
    // Shell de dos columnas (ADR 0005): sidebar fijo, contenido con scroll
    // propio. El dashboard va sobre `--surface-app`, sin textura.
    <div className="flex h-svh overflow-hidden bg-[var(--surface-app)]">
      <AppI18nProvider lang={lang} dict={t}>
        <PostHogIdentify
          distinctId={session.user.id}
          email={session.user.email}
        />
        <AppSidebar
          email={session.user.email ?? ""}
          signOutAction={signOutAction}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {/* La franja de cuota va dentro del `main`, al ancho de la columna. */}
          <QuotaNoticeBar notice={notice} t={t} />
          {/* PADDING DEL LAYOUT: el contenedor aporta 36px horizontales, 28px
            arriba y 32px abajo (spec C.7). Cada pantalla dibuja su cabecera y
            su cuerpo sin repetir estos paddings; solo el espacio entre ambos
            (24px) corre por su cuenta. */}
          <div className="px-9 pt-7 pb-8">{children}</div>
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
