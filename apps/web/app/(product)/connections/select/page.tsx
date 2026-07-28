import Link from "next/link"
import { redirect } from "next/navigation"
import { Link2, TriangleAlert } from "lucide-react"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { PageSelectionForm } from "@/features/connect-meta/ui/page-selection-form"
import { auth } from "@/auth"
import { resolvePlanLimits } from "@/lib/billing/entitlements"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"
import { listAuthorizedPages, type ConnectedPage } from "@/lib/meta"
import { getMetaUserAccessToken } from "@/lib/pages/meta-user-token"
import { countActivePages, getPageOwnership } from "@/lib/pages/page-registry"
import {
  classifyPagesForSelection,
  formatPageAllowance,
} from "@/lib/pages/page-selection"

// v2 no dibuja esta pantalla (ADR 0005): se resuelve con el mismo lenguaje
// visual de B1/B2 y sus cuatro estados propios — sin autorización de Meta,
// plan sin resolver, lista clasificada y error de validación al confirmar.
export default async function SelectPagesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const tenantId = session.user.id

  // Sin user access token guardado no hay nada que listar: el usuario todavía
  // no pasó por el diálogo de Meta (o su credencial dejó de ser legible).
  const userToken = await getMetaUserAccessToken(tenantId)
  if (!userToken) {
    return (
      <Shell>
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)] sm:flex-row sm:items-center">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-primary"
            aria-hidden
          >
            <Link2 className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-heading text-base font-semibold">
              Todavía no autorizaste tus páginas en Meta.
            </h2>
            <p className="mt-1 text-[13.5px]/[1.55] text-muted-foreground">
              Necesitamos tu autorización para listar las páginas que
              administras. Conecta Facebook y vuelves acá a elegir cuáles
              conectar.
            </p>
          </div>
          <ConnectFacebookButton />
        </section>
      </Shell>
    )
  }

  let metaPages: ConnectedPage[]
  try {
    metaPages = await listAuthorizedPages(userToken)
  } catch (error) {
    console.error("meta pages fetch failed", error)
    redirect("/connections?meta=error&reason=meta_session_expired")
  }

  const [subscription, activePageCount, ownership] = await Promise.all([
    getSubscriptionByTenantId(tenantId),
    countActivePages(tenantId),
    getPageOwnership(metaPages.map((page) => page.pageId)),
  ])

  // Plan desconocido = fail-closed, igual que el resto de los gates: no
  // dejamos conectar páginas sin límite resuelto.
  const limits = resolvePlanLimits(subscription?.priceLookupKey ?? null)
  if (!limits) {
    return (
      <Shell>
        <section className="flex items-start gap-3 rounded-2xl border border-destructive-soft-border bg-destructive-soft p-[22px] text-destructive-soft-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="text-[13.5px] font-medium">
              No pudimos resolver los límites de tu plan.
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              Escríbenos a info@resender.dev para revisar tu suscripción antes
              de conectar páginas.
            </p>
          </div>
        </section>
      </Shell>
    )
  }

  const view = classifyPagesForSelection({
    metaPages: metaPages.map((page) => ({
      pageId: page.pageId,
      name: page.name,
    })),
    ownership,
    tenantId,
    activePageCount,
    maxPages: limits.maxPages,
  })

  return (
    <Shell>
      {/* Cuántas puede añadir, antes de elegir: el mismo texto que devuelve la
          validación del servidor, desde el módulo de dominio. */}
      <section className="rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)]">
        <h2 className="font-heading text-base font-semibold">Tu plan</h2>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Tienes {view.activePageCount} de {view.maxPages} páginas conectadas.{" "}
          {formatPageAllowance(view)}
        </p>
      </section>
      <PageSelectionForm view={view} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header>
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
          {"// conexiones"}
        </p>
        <h1 className="mt-1.5 font-heading text-[26px] font-bold tracking-[-0.02em]">
          Elegir páginas
        </h1>
        <p className="mt-2 max-w-[620px] text-[14.5px]/[1.6] text-muted-foreground">
          Elige cuáles de las páginas que administras en Facebook quieres
          conectar a Resender.
        </p>
      </header>
      <div className="mt-6 flex flex-col gap-3.5">{children}</div>
      <p className="mt-5 text-[13.5px]">
        <Link
          href="/connections"
          className="text-muted-foreground underline underline-offset-4"
        >
          Volver a Conexiones sin conectar nada
        </Link>
      </p>
    </div>
  )
}
