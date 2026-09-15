"use client"

import { useOptimistic, useState, useTransition } from "react"
import { LoaderCircle } from "lucide-react"

import type { ForwardingPauseState } from "@/features/connections/actions"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// Interruptor de la pausa de reenvío (ADR 0020), el mismo para la conexión y
// para la conversación: cambia la acción y el texto, no el control.
//
// **Encendido = reenviando.** Es lo que un interruptor significa en cualquier
// panel: apagado es «esto no está pasando». El texto de al lado lo dice con
// todas las letras —«Activo» / «Pausado desde hace 2 h»— porque un switch solo
// no cuenta desde cuándo, y eso es lo primero que se pregunta quien ve un
// webhook mudo.
//
// `useOptimistic` y no estado local: el valor salta al instante, y cuando la
// acción revalida la pantalla vuelve a mandar la prop, sin un efecto que
// sincronice. Si la acción falla, React descarta el optimista solo.
export function ForwardingPauseSwitch({
  pausedAt,
  label,
  activeLabel,
  pausedLabel,
  pausedFallbackLabel,
  ariaLabel,
  action,
  size = "default",
  className,
}: {
  /** ISO o null. Null = reenviando. */
  pausedAt: string | null
  /** Encabezado del control: «Reenvío al webhook». */
  label: string
  /** Estado en claro cuando reenvía. */
  activeLabel: string
  /** Estado en claro cuando está pausado, ya con el «desde hace…». */
  pausedLabel: string | null
  /** Mientras la pausa recién puesta no tiene fecha todavía. */
  pausedFallbackLabel: string
  ariaLabel: string
  action: (paused: boolean) => Promise<ForwardingPauseState>
  size?: "sm" | "default"
  className?: string
}) {
  const [paused, setPaused] = useOptimistic(pausedAt !== null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (forwarding: boolean) => {
    setError(null)
    startTransition(async () => {
      setPaused(!forwarding)
      const result = await action(!forwarding)
      if (result.error) setError(result.error)
    })
  }

  const stateText = paused
    ? (pausedLabel ?? pausedFallbackLabel)
    : activeLabel

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="flex items-center gap-2.5">
        <Switch
          size={size}
          checked={!paused}
          onCheckedChange={toggle}
          disabled={pending}
          aria-label={ariaLabel}
        />
        <span className="text-[13px] font-medium">{label}</span>
        <span
          className={cn(
            "flex items-center gap-1.5 text-[12.5px]",
            paused ? "text-[var(--warning-text)]" : "text-success-text"
          )}
        >
          {pending ? (
            <LoaderCircle className="size-3 animate-spin" aria-hidden />
          ) : null}
          {stateText}
        </span>
      </label>
      {error ? (
        <p className="text-[12.5px] text-[var(--danger-text)]">{error}</p>
      ) : null}
    </div>
  )
}
