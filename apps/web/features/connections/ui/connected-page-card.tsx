"use client"

import { useActionState } from "react"

import {
  disconnectPageAction,
  saveWebhookUrlAction,
  type ConnectionActionState,
} from "@/features/connections/actions"
import { Button } from "@workspace/ui/components/button"

export type ConnectedPageView = {
  id: string
  metaPageId: string
  name: string
  status: "active" | "disconnected"
  tokenStatus: "valid" | "invalid"
  tokenError: string | null
  tokenErrorAt: string | null
  webhookUrl: string | null
  connectedAt: string
  disconnectedAt: string | null
}

export function ConnectedPageCard({ page }: { page: ConnectedPageView }) {
  const [saveState, saveAction, savePending] = useActionState<
    ConnectionActionState,
    FormData
  >(saveWebhookUrlAction, {})
  const [disconnectState, disconnectAction, disconnectPending] = useActionState<
    ConnectionActionState,
    FormData
  >(disconnectPageAction, {})
  const active = page.status === "active"

  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{page.name}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                active
                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {active ? "active" : "disconnected"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Page ID: {page.metaPageId}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Connected: {new Date(page.connectedAt).toLocaleString()}
          </p>
        </div>
      </div>

      {active ? (
        <div className="mt-5 grid gap-4">
          {page.tokenStatus === "invalid" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">This Page needs to be reconnected.</p>
              <p className="mt-1">
                Meta rejected the Page token. Reconnect it from Facebook to renew
                permissions before sending replies again.
              </p>
              {page.tokenError && (
                <p className="mt-2 text-xs opacity-85">{page.tokenError}</p>
              )}
              {page.tokenErrorAt && (
                <p className="mt-1 text-xs opacity-75">
                  Detected: {new Date(page.tokenErrorAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          <form action={saveAction} className="grid gap-2">
            <input type="hidden" name="connectionId" value={page.id} />
            <label className="text-sm font-medium" htmlFor={`webhook-${page.id}`}>
              Webhook URL
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={`webhook-${page.id}`}
                name="webhookUrl"
                type="url"
                defaultValue={page.webhookUrl ?? ""}
                placeholder="https://your-automation.example/webhook"
                className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              />
              <Button type="submit" disabled={savePending}>
                {savePending ? "Saving..." : "Save"}
              </Button>
            </div>
            <ActionMessage state={saveState} />
          </form>

          <form
            action={disconnectAction}
            onSubmit={(event) => {
              const ok = window.confirm(
                "Disconnecting this Page will stop future traffic but keeps the history. Continue?"
              )
              if (!ok) event.preventDefault()
            }}
          >
            <input type="hidden" name="connectionId" value={page.id} />
            <Button type="submit" variant="destructive" disabled={disconnectPending}>
              {disconnectPending ? "Disconnecting..." : "Disconnect"}
            </Button>
            <ActionMessage state={disconnectState} />
          </form>
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Disconnected
          {page.disconnectedAt
            ? ` on ${new Date(page.disconnectedAt).toLocaleString()}`
            : ""}
          . The history remains available in the message log.
        </p>
      )}
    </article>
  )
}

function ActionMessage({ state }: { state: ConnectionActionState }) {
  if (state.error) {
    return <p className="text-sm text-destructive">{state.error}</p>
  }
  if (state.message) {
    return <p className="text-sm text-green-700">{state.message}</p>
  }
  return null
}
