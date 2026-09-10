"use client"

import Link from "next/link"
import { useActionState, useState } from "react"
import { LoaderCircle } from "lucide-react"

import {
  connectSelectedPagesAction,
  type ConnectMetaActionState,
} from "@/features/connect-meta/actions"
import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  formatPageAllowance,
  type PageSelectionView,
} from "@/lib/pages/page-selection"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

// Los tipos de la vista son los del módulo de dominio (`lib/pages/page-selection`):
// estaban redeclarados acá y las dos copias podían divergir en silencio.
//
// Lista del mock `1g`: tarjeta con cabecera mono, una fila por página separada
// por un divisor tenue, el checkbox de shadcn a la izquierda y el motivo a la
// derecha. El `Checkbox` lleva `name="pageIds"` y `value`: Radix emite el
// `<input>` oculto dentro del form, así que la server action recibe lo mismo
// que con el checkbox nativo.
export function PageSelectionForm({ view }: { view: PageSelectionView }) {
  const [state, action, pending] = useActionState<
    ConnectMetaActionState,
    FormData
  >(connectSelectedPagesAction, {})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const t = useAppDict()

  const atLimit = selected.size >= view.remainingSlots

  const toggle = (metaPageId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(metaPageId)
      else next.delete(metaPageId)
      return next
    })
  }

  if (view.pages.length === 0) {
    return (
      <>
        <section className="rounded-2xl border border-dashed border-border-strong p-10 text-center">
          <h2 className="font-heading text-[17px] font-semibold tracking-[-0.01em]">
            {t.select.emptyTitle}
          </h2>
          <p className="mx-auto mt-1.5 max-w-[440px] text-[13.5px]/[1.6] text-muted-foreground">
            {t.select.emptyBody}
          </p>
        </section>
        <p>
          <Link
            href="/connections"
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            {t.select.back}
          </Link>
        </p>
      </>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-sm)]">
        <h2 className="border-b border-border-faint px-5 py-3 font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
          {t.select.listHeading}
        </h2>
        <ul>
          {view.pages.map((page, index) => {
            const connected = page.state === "already_connected"
            const foreign = page.state === "owned_by_other_tenant"
            const blockedByLimit =
              page.state === "selectable" &&
              atLimit &&
              !selected.has(page.metaPageId)
            const disabled = connected || foreign || blockedByLimit
            const inputId = `page-${page.metaPageId}`
            const last = index === view.pages.length - 1

            return (
              <li
                key={page.metaPageId}
                className={`flex items-center gap-3.5 px-5 py-3.5 ${
                  last ? "" : "border-b border-border-faint"
                } ${
                  connected || foreign
                    ? "opacity-70"
                    : blockedByLimit
                      ? "opacity-55"
                      : "hover:bg-surface-sunken"
                }`}
              >
                <Checkbox
                  id={inputId}
                  name="pageIds"
                  value={page.metaPageId}
                  checked={connected || selected.has(page.metaPageId)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    toggle(page.metaPageId, checked === true)
                  }
                />
                <label
                  htmlFor={inputId}
                  className={`min-w-0 flex-1 ${disabled ? "" : "cursor-pointer"}`}
                >
                  <span className="block text-sm font-medium">{page.name}</span>
                  {/* El motivo se dice en la fila: si no, falta una página que
                      el usuario sí administra y nadie explica por qué. Los ids
                      van en mono; las explicaciones, en sans. */}
                  {connected ? (
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                      {t.select.connectedBody}
                    </span>
                  ) : foreign ? (
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                      {t.select.foreignBody}
                    </span>
                  ) : (
                    <span className="mt-0.5 block font-mono text-[11.5px] text-[var(--text-subtle)]">
                      page_id {page.metaPageId}
                    </span>
                  )}
                </label>
                {connected && (
                  <Badge variant="success" className="font-normal">
                    {t.select.badgeConnected}
                  </Badge>
                )}
                {foreign && (
                  <Badge
                    variant="outline"
                    className="border-border bg-[var(--accent)] font-normal text-muted-foreground"
                  >
                    {t.select.badgeForeign}
                  </Badge>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <p className="text-[12.5px] text-muted-foreground">
        {t.select.addOnlyHint}
      </p>

      {atLimit && (
        <p className="rounded-[10px] bg-surface-sunken px-3.5 py-3 text-[13px] text-muted-foreground">
          {view.remainingSlots === 0
            ? formatPageAllowance(view, t)
            : fmt(t.select.atLimitHint, {
                remainingSlots: view.remainingSlots,
                maxPages: view.maxPages,
              })}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/connections"
          className="text-[13px] text-muted-foreground hover:text-foreground"
        >
          {t.select.back}
        </Link>
        <div className="flex flex-col items-end gap-2">
          <Button
            type="submit"
            size="lg"
            className="px-4 text-[13.5px]"
            disabled={pending || selected.size === 0}
          >
            {pending && (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            )}
            {pending ? t.select.submitting : t.select.submit}
          </Button>
          <ActionMessage state={state} />
        </div>
      </div>
    </form>
  )
}

function ActionMessage({ state }: { state: ConnectMetaActionState }) {
  if (state.error) {
    return (
      <p className="text-[13px] text-[var(--danger-text)]">{state.error}</p>
    )
  }
  if (state.message) {
    return <p className="text-[13px] text-success-text">{state.message}</p>
  }
  return null
}
