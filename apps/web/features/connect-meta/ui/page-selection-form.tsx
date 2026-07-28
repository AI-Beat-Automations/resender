"use client"

import { useActionState, useState } from "react"

import {
  connectSelectedPagesAction,
  type ConnectMetaActionState,
} from "@/features/connect-meta/actions"
import { Button } from "@workspace/ui/components/button"

export type SelectablePageView = {
  metaPageId: string
  name: string
  state: "selectable" | "already_connected" | "owned_by_other_tenant"
}

export type PageSelectionView = {
  pages: SelectablePageView[]
  maxPages: number
  activePageCount: number
  remainingSlots: number
}

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
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
        Meta didn&apos;t return any Page you administer. Make sure you granted
        access to your Pages and try connecting Facebook again.
      </div>
    )
  }

  return (
    <form action={action} className="grid gap-4">
      <ul className="grid gap-2">
        {view.pages.map((page) => {
          const connected = page.state === "already_connected"
          const foreign = page.state === "owned_by_other_tenant"
          const blockedByLimit =
            page.state === "selectable" &&
            atLimit &&
            !selected.has(page.metaPageId)

          return (
            <li
              key={page.metaPageId}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
            >
              <input
                type="checkbox"
                id={`page-${page.metaPageId}`}
                name="pageIds"
                value={page.metaPageId}
                className="mt-1 size-4"
                checked={connected || selected.has(page.metaPageId)}
                disabled={connected || foreign || blockedByLimit}
                onChange={(event) =>
                  toggle(page.metaPageId, event.target.checked)
                }
              />
              <div className="grid gap-1">
                <label
                  className="text-sm font-medium"
                  htmlFor={`page-${page.metaPageId}`}
                >
                  {page.name}
                </label>
                <p className="text-xs text-muted-foreground">
                  Page ID: {page.metaPageId}
                </p>
                {connected && (
                  <p className="text-xs text-muted-foreground">
                    Already connected
                  </p>
                )}
                {foreign && (
                  <p className="text-xs text-muted-foreground">
                    Already connected in another Resender account
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        This screen only adds Pages: unchecking a connected Page never
        disconnects it. Disconnect from Connections instead.
      </p>

      {atLimit && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {view.remainingSlots === 0
            ? `Your plan allows ${view.maxPages} connected Pages and you already have ${view.activePageCount} active. Disconnect a Page in Connections to add another one.`
            : `You reached the ${view.remainingSlots} Page${
                view.remainingSlots === 1 ? "" : "s"
              } left on your plan (${view.maxPages} in total). Uncheck one to pick a different Page, or disconnect a Page in Connections.`}
        </p>
      )}

      <div>
        <Button type="submit" disabled={pending || selected.size === 0}>
          {pending ? "Connecting..." : "Connect selected Pages"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  )
}

function ActionMessage({ state }: { state: ConnectMetaActionState }) {
  if (state.error) {
    return <p className="mt-2 text-sm text-destructive">{state.error}</p>
  }
  if (state.message) {
    return <p className="mt-2 text-sm text-green-700">{state.message}</p>
  }
  return null
}
