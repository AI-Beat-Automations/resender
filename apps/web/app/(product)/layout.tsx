import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"
import { PostHogIdentify } from "@/components/posthog-identify"
import {
  QuotaNoticeBar,
  type QuotaNoticeView,
} from "@/features/billing/ui/quota-notice-bar"
import { AppSidebar } from "@/features/shell/ui/app-sidebar"
import {
  productPageRedirect,
  productShellFailureDecision,
  productShellNotice,
} from "@/lib/access/product-gates"
import {
  getProductAccess,
  getProductShell,
} from "@/lib/backend/backend"
import { privatePageMetadata } from "@/lib/seo"

// La app logueada no tiene nada que hacer en el índice. Lo heredan
// /connections, /messages y /settings.
export const metadata = privatePageMetadata("Resender")

export default async function ProductLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const actor = { userId: session.user.id }
  const access = await getProductAccess(actor)
  const destination = productPageRedirect(access)
  if (destination) redirect(destination)

  // El backend conserva el ownership del entitlement y del umbral de aviso.
  // Los errores de protocolo siempre abortan; un fallo operacional posterior
  // al access gate solo omite la franja, como hacía la lectura anterior.
  let notice: QuotaNoticeView | null = null
  let shellDestination: "/waitlist" | "/billing" | null = null
  try {
    notice = productShellNotice(await getProductShell(actor))
  } catch (error) {
    const decision = productShellFailureDecision(error)
    if (decision.kind === "redirect") {
      shellDestination = decision.destination
    } else if (decision.kind === "omit_notice") {
      console.error("product shell notice unavailable", decision.log)
    } else {
      throw error
    }
  }
  // `redirect()` throws; keep it outside the catch so Next owns the control
  // flow instead of classifying it as a backend failure.
  if (shellDestination) redirect(shellDestination)

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/" })
  }

  return (
    // Shell de dos columnas (ADR 0005): sidebar fijo, contenido con scroll
    // propio. El dashboard va sobre `--surface-app`, sin textura.
    <div className="flex h-svh overflow-hidden bg-[var(--surface-app)]">
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
        <QuotaNoticeBar notice={notice} />
        {/* PADDING DEL LAYOUT: el contenedor aporta 36px horizontales, 28px
            arriba y 32px abajo (spec C.7). Cada pantalla dibuja su cabecera y
            su cuerpo sin repetir estos paddings; solo el espacio entre ambos
            (24px) corre por su cuenta. */}
        <div className="px-9 pt-7 pb-8">{children}</div>
      </main>
    </div>
  )
}
