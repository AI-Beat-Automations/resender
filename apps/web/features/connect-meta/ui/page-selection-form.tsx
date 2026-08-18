"use client"

import { useActionState, useState } from "react"
import { LoaderCircle } from "lucide-react"

import {
  connectSelectedPagesAction,
  type ConnectMetaActionState,
} from "@/features/connect-meta/actions"
import {
  formatPageAllowance,
  type PageSelectionView,
} from "@/lib/pages/page-selection"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"

// Los tipos de la vista son los del módulo de dominio (`lib/pages/page-selection`):
// estaban redeclarados acá y las dos copias podían divergir en silencio.
export function PageSelectionForm({ view }: { view: PageSelectionView }) {
  const [state, action, pending] = useActionState<
    ConnectMetaActionState,
    FormData
  >(connectSelectedPagesAction, {})
  const [selected, setSelected] = useState<Set<string>>(new Set())

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
      <section className="rounded-2xl border border-dashed border-border-strong bg-card p-10 text-center">
        <h2 className="font-heading text-[18px] font-semibold tracking-[-0.02em]">
          Todavía no hay páginas que puedas conectar.
        </h2>
        <p className="mx-auto mt-2 max-w-[460px] text-sm/[1.6] text-muted-foreground">
          Meta no devolvió ninguna página que administres. Revisa que le hayas
          dado acceso a tus páginas y vuelve a conectar Facebook.
        </p>
      </section>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
        PÁGINAS QUE ADMINISTRAS
      </h2>

      <ul className="flex flex-col gap-2.5">
        {view.pages.map((page) => {
          const connected = page.state === "already_connected"
          const foreign = page.state === "owned_by_other_tenant"
          const blockedByLimit =
            page.state === "selectable" &&
            atLimit &&
            !selected.has(page.metaPageId)
          const disabled = connected || foreign || blockedByLimit
          const inputId = `page-${page.metaPageId}`

          return (
            <li key={page.metaPageId}>
              <Label
                htmlFor={inputId}
                className={`flex items-start gap-3 rounded-2xl border border-border bg-card p-4 font-normal ${
                  disabled ? "opacity-75" : "cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  id={inputId}
                  name="pageIds"
                  value={page.metaPageId}
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={connected || selected.has(page.metaPageId)}
                  disabled={disabled}
                  onChange={(event) =>
                    toggle(page.metaPageId, event.target.checked)
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-base font-semibold">
                      {page.name}
                    </span>
                    {connected && <Badge variant="success">ya conectada</Badge>}
                    {/* El motivo se dice en la fila: si no, falta una página
                        que el usuario sí administra y nadie explica por qué. */}
                    {foreign && <Badge variant="ghost">en otra cuenta</Badge>}
                  </span>
                  <span className="mt-1 block font-mono text-[11.5px] text-[var(--text-subtle)]">
                    page_id {page.metaPageId}
                  </span>
                  {foreign && (
                    <span className="mt-1 block text-[12.5px] text-muted-foreground">
                      Ya está conectada en otra cuenta de Resender. Una página
                      pertenece a una sola cuenta.
                    </span>
                  )}
                  {connected && (
                    <span className="mt-1 block text-[12.5px] text-muted-foreground">
                      Ya la tienes conectada y activa.
                    </span>
                  )}
                </span>
              </Label>
            </li>
          )
        })}
      </ul>

      <p className="text-[12.5px] text-muted-foreground">
        Esta pantalla solo agrega páginas: desmarcar una página conectada nunca
        la desconecta.
      </p>

      {atLimit && (
        <p className="rounded-lg bg-surface-sunken px-3.5 py-3 text-[13px] text-muted-foreground">
          {view.remainingSlots === 0
            ? formatPageAllowance(view)
            : `Ya marcaste las ${view.remainingSlots} que te permite tu plan (${view.maxPages} conexiones en total). Desmarca una para elegir otra, o desconecta una para liberar cupo.`}
        </p>
      )}

      <div>
        <Button
          type="submit"
          size="lg"
          disabled={pending || selected.size === 0}
        >
          {pending && (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          )}
          {pending ? "Conectando…" : "Conectar las páginas elegidas"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  )
}

function ActionMessage({ state }: { state: ConnectMetaActionState }) {
  if (state.error) {
    return (
      <p className="mt-2 text-[13px] text-[var(--danger-text)]">
        {state.error}
      </p>
    )
  }
  if (state.message) {
    return <p className="mt-2 text-[13px] text-success-text">{state.message}</p>
  }
  return null
}
