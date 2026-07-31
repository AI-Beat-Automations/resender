import Link from "next/link"
import { redirect } from "next/navigation"
import { Link2, TriangleAlert } from "lucide-react"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { PageSelectionForm } from "@/features/connect-meta/ui/page-selection-form"
import { auth } from "@/auth"
import { BackendRpcError, listAuthorizedMetaPages } from "@/lib/backend/backend"
import { formatPageAllowance } from "@/lib/pages/page-selection"

// v2 no dibuja esta pantalla (ADR 0005): se resuelve con el mismo lenguaje
// visual de B1/B2 y sus cuatro estados propios — sin autorización de Meta,
// plan sin resolver, lista clasificada y error de validación al confirmar.
export default async function SelectPagesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const tenantId = session.user.id

  let selection
  try {
    selection = await listAuthorizedMetaPages({ userId: tenantId })
  } catch (error) {
    if (error instanceof BackendRpcError) {
      if (error.classification.destination) {
        redirect(error.classification.destination)
      }
      if (error.classification.kind === "provider") {
        return <MissingAuthorization />
      }
    }
    return <SelectionUnavailable />
  }

  const view = {
    pages: selection.pages.map((page) => ({
      metaPageId: page.providerPageId,
      name: page.name,
      state: page.state,
    })),
    maxPages: selection.maxPages,
    activePageCount: selection.activePageCount,
    remainingSlots: selection.remainingSlots,
  }

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

function MissingAuthorization() {
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
            Necesitamos tu autorización para listar las páginas que administras.
            Conecta Facebook y vuelves acá a elegir cuáles conectar.
          </p>
        </div>
        <ConnectFacebookButton />
      </section>
    </Shell>
  )
}

function SelectionUnavailable() {
  return (
    <Shell>
      <section className="flex items-start gap-3 rounded-2xl border border-destructive-soft-border bg-destructive-soft p-[22px] text-destructive-soft-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="text-[13.5px] font-medium">
            No pudimos cargar tus páginas.
          </p>
          <p className="mt-1 text-[13px]/[1.55]">
            Inténtalo de nuevo en unos minutos.
          </p>
        </div>
      </section>
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
