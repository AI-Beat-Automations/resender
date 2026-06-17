"use client"

import { useActionState } from "react"

import {
  createApiKeyAction,
  revokeApiKeyAction,
  type CreateApiKeyState,
  type RevokeApiKeyState,
} from "@/features/api-keys/actions"
import { Button } from "@workspace/ui/components/button"

export type ApiKeyView = {
  id: string
  label: string
  visiblePrefix: string
  status: "active" | "revoked"
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export function ApiKeysPanel({ apiKeys }: { apiKeys: ApiKeyView[] }) {
  const [createState, createAction, createPending] = useActionState<
    CreateApiKeyState,
    FormData
  >(createApiKeyAction, {})

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-medium">Crear API key</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Usa API keys opacas para que N8N o tu backend llamen la API externa
          de Resender. El secreto completo se muestra solo una vez.
        </p>
        <form action={createAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            name="label"
            required
            maxLength={80}
            placeholder="N8N produccion"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
          <Button type="submit" disabled={createPending}>
            {createPending ? "Creando..." : "Crear key"}
          </Button>
        </form>
        {createState.error && (
          <p className="mt-3 text-sm text-destructive">{createState.error}</p>
        )}
        {createState.apiKey && (
          <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-950 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-100">
            <p className="font-medium">{createState.message}</p>
            <code className="mt-2 block break-all rounded-lg bg-background/70 p-3 text-foreground">
              {createState.apiKey}
            </code>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-medium">API keys</h2>
        {apiKeys.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Todavia no creaste API keys.
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            {apiKeys.map((apiKey) => (
              <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKeyView }) {
  const [state, action, pending] = useActionState<RevokeApiKeyState, FormData>(
    revokeApiKeyAction,
    {}
  )
  const active = apiKey.status === "active"

  return (
    <article className="rounded-xl border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{apiKey.label}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                active
                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {apiKey.status}
            </span>
          </div>
          <dl className="mt-2 grid gap-1 text-sm text-muted-foreground">
            <div>Prefix: {apiKey.visiblePrefix}...</div>
            <div>Creada: {new Date(apiKey.createdAt).toLocaleString()}</div>
            <div>
              Ultimo uso: {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : "nunca"}
            </div>
            {apiKey.revokedAt && (
              <div>Revocada: {new Date(apiKey.revokedAt).toLocaleString()}</div>
            )}
          </dl>
        </div>
        {active && (
          <form
            action={action}
            onSubmit={(event) => {
              if (!window.confirm("Revocar esta API key?")) event.preventDefault()
            }}
          >
            <input type="hidden" name="apiKeyId" value={apiKey.id} />
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Revocando..." : "Revocar"}
            </Button>
          </form>
        )}
      </div>
      {state.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="mt-2 text-sm text-green-700">{state.message}</p>}
    </article>
  )
}
