"use client"

import type { WhatsappTemplateActionState } from "@/features/whatsapp-templates/actions"

// El rechazo de una Server Action, en dos niveles.
//
// Arriba, traducido: es lo que el producto puede explicar en el idioma del
// usuario, y sale del código estable del fallo y no de su texto. Debajo y en
// mono, el texto crudo de Meta, que sólo aparece cuando lo nuestro no puede ser
// específico —un rechazo de Graph—: es una **cita** y no copy nuestro, y por eso
// se distingue tipográficamente en vez de mezclarse con la frase de arriba.

export function TemplateActionError({
  state,
}: {
  state: WhatsappTemplateActionState
}) {
  if (!state.error) return null

  return (
    <div className="text-[13px]/[1.5] text-destructive">
      <p>{state.error}</p>
      {state.detail ? (
        <p className="mt-1 font-mono text-[12px] break-words">{state.detail}</p>
      ) : null}
    </div>
  )
}
