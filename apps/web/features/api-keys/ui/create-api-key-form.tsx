"use client"

import { useActionState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"

import {
  createApiKeyAction,
  type CreateApiKeyState,
} from "@/features/api-keys/actions"
import { CopyButton } from "@/features/settings/ui/copy-button"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

export function CreateApiKeyForm() {
  const [state, action, pending] = useActionState<CreateApiKeyState, FormData>(
    createApiKeyAction,
    {}
  )

  return (
    <SettingsCard>
      <SettingsCardTitle>Crear API key</SettingsCardTitle>
      <p className="mt-1 max-w-150 text-[13.5px]/[1.55] text-muted-foreground">
        Usa API keys opacas para que n8n o tu backend llamen a la API externa de
        Resender. El secreto completo se muestra una sola vez.
      </p>
      <form action={action} className="mt-4 flex max-w-130 gap-2.5">
        <Input
          name="label"
          required
          maxLength={80}
          placeholder="n8n producción"
          aria-label="Etiqueta de la API key"
          className="flex-1"
        />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              Creando…
            </>
          ) : (
            "Crear key"
          )}
        </Button>
      </form>
      {state.error ? (
        <p className="mt-3 text-[13px] text-destructive">{state.error}</p>
      ) : null}
      {state.apiKey ? (
        // Tinte de aviso con su borde (regla del DS: el soft nunca va suelto).
        // Es la única vez que el secreto existe en pantalla.
        <div className="mt-4 rounded-lg border border-warning-soft-border bg-warning-soft p-4 text-warning-soft-foreground">
          <p className="flex items-center gap-2 text-[13.5px] font-medium">
            <TriangleAlert className="size-[15px] shrink-0" aria-hidden />
            Copia la key ahora: no vamos a volver a mostrarla.
          </p>
          <div className="mt-3 flex gap-2.5">
            <code className="flex-1 overflow-hidden rounded-lg bg-card px-3.5 py-3 font-mono text-[12.5px] text-ellipsis whitespace-nowrap text-foreground">
              {state.apiKey}
            </code>
            <CopyButton
              value={state.apiKey}
              label="Copiar la API key"
              withText
              variant="default"
              size="lg"
            />
          </div>
        </div>
      ) : null}
    </SettingsCard>
  )
}
