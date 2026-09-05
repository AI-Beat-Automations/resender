"use client"

import Link from "next/link"
import { useActionState, useState } from "react"
import { LoaderCircle } from "lucide-react"

import {
  connectSelectedPagesAction,
  type ConnectMetaActionState,
} from "@/features/connect-meta/actions"
import { EmptyState } from "@/features/shell/ui/empty-state"
import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  formatPageAllowance,
  type PageSelectionView,
} from "@/lib/pages/page-selection"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

// Los tipos de la vista son los del módulo de dominio (`lib/pages/page-selection`):
// estaban redeclarados acá y las dos copias podían divergir en silencio.
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
        <EmptyState title={t.select.emptyTitle} body={t.select.emptyBody} />
        <div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          >
            <Link href="/connections">{t.select.back}</Link>
          </Button>
        </div>
      </>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      {/* Lista en una sola `Card` con filas separadas (mock 1g). */}
      <Card className="gap-0 py-0">
        <h2 className="border-b border-border-subtle px-5 py-3 font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
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
                className={cn(!last && "border-b border-border-subtle")}
              >
                <Label
                  htmlFor={inputId}
                  className={cn(
                    "flex items-center gap-3.5 px-5 py-3.5 font-normal",
                    disabled
                      ? "opacity-70"
                      : "cursor-pointer hover:bg-surface-sunken"
                  )}
                >
                  {/* `Checkbox` de shadcn emite un `<input hidden>` con el
                      mismo `name`/`value` que el checkbox nativo de antes, así
                      que el server action recibe exactamente lo mismo. */}
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
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {page.name}
                    </span>
                    {/* El motivo se dice en la fila: si no, falta una página
                        que el usuario sí administra y nadie explica por qué. */}
                    {foreign ? (
                      <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                        {t.select.foreignBody}
                      </span>
                    ) : connected ? (
                      <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                        {t.select.connectedBody}
                      </span>
                    ) : (
                      <span className="mt-0.5 block font-mono text-[11.5px] text-[var(--text-subtle)]">
                        page_id {page.metaPageId}
                      </span>
                    )}
                  </span>
                  {connected && (
                    <Badge variant="success">{t.select.badgeConnected}</Badge>
                  )}
                  {foreign && (
                    <Badge variant="ghost" className="bg-muted">
                      {t.select.badgeForeign}
                    </Badge>
                  )}
                  {blockedByLimit && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t.select.badgeAtLimit}
                    </span>
                  )}
                </Label>
              </li>
            )
          })}
        </ul>
      </Card>

      <p className="text-[12.5px] text-muted-foreground">
        {t.select.addOnlyHint}
      </p>

      {atLimit && (
        <p className="text-[13px] text-muted-foreground">
          {view.remainingSlots === 0
            ? formatPageAllowance(view, t)
            : fmt(t.select.atLimitHint, {
                remainingSlots: view.remainingSlots,
                maxPages: view.maxPages,
              })}
        </p>
      )}

      <ActionMessage state={state} />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/connections">{t.select.back}</Link>
        </Button>
        <Button type="submit" disabled={pending || selected.size === 0}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden />}
          {pending ? t.select.submitting : t.select.submit}
        </Button>
      </div>
    </form>
  )
}

function ActionMessage({ state }: { state: ConnectMetaActionState }) {
  if (state.error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle className="font-normal">{state.error}</AlertTitle>
      </Alert>
    )
  }
  if (state.message) {
    return (
      <Alert variant="success" role="status">
        <AlertTitle className="font-normal">{state.message}</AlertTitle>
      </Alert>
    )
  }
  return null
}
