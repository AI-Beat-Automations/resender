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
// todas las letras —«Activa» / «Pausada desde hace 2 h»— porque un switch solo
// no cuenta desde cuándo, y eso es lo primero que se pregunta quien ve un
// webhook mudo.
//
// En pantalla se llama «Automatización», no «reenvío al webhook»: el cliente
// piensa en que su bot recibe o no los mensajes, no en el mecanismo.
//
// `useOptimistic` y no estado local: el valor salta al instante, y cuando la
// acción revalida la pantalla vuelve a mandar la prop, sin un efecto que
// sincronice. Si la acción falla, React descarta el optimista solo.
export function ForwardingPauseSwitch({
  pausedAt,
  label,
  state,
  ariaLabel,
  action,
  size = "default",
  className,
}: {
  /** ISO o null. Null = reenviando. */
  pausedAt: string | null
  /** Encabezado del control: «Automatización». */
  label: string
  /**
   * Los textos de estado junto al switch, o `null` para no pintar ninguno.
   * Conexiones los pone («Activa» / «Pausada desde hace 2 h»); el hilo de
   * Inbox no, porque ahí el desde cuándo lo cuenta el propio hilo (ADR 0021)
   * y el switch a secas ya dice si está encendida.
   */
  state: {
    /** Cuando reenvía. */
    active: string
    /** Cuando está pausado, ya con el «desde hace…»; null si aún no hay fecha. */
    paused: string | null
    /** Mientras la pausa recién puesta no tiene fecha todavía. */
    pausedFallback: string
  } | null
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

  const stateText = state
    ? paused
      ? (state.paused ?? state.pausedFallback)
      : state.active
    : null

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
        {stateText !== null || pending ? (
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
        ) : null}
      </label>
      {error ? (
        <p className="text-[12.5px] text-[var(--danger-text)]">{error}</p>
      ) : null}
    </div>
  )
}
