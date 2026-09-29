import { asRecord, asString } from "./coerce"
import type { WhatsappWabaChange } from "./envelope"
import { readTemplateCategory, readTemplateRef } from "./template-ref"
import type { WhatsappTemplateStatusEvent } from "./types"

// `field: "message_template_status_update"`: Meta aprobó, rechazó, pausó o
// deshabilitó una plantilla. Un `value` por cambio, sin arrays.

// Eventos que Meta manda por este campo y **no** son un estado de la
// plantilla: se loguean y no tocan la copia.
//
// - `FLAGGED`: recibió quejas y está en riesgo de pausa, pero se sigue
//   enviando. Escribirlo como estado bloquearía envíos que Meta acepta.
// - `LOCKED`: no se puede editar. No dice nada sobre si se puede enviar.
// - `UNARCHIVED`: «vuelve a su estado anterior», que el webhook no dice. Se
//   marca para volver a sincronizar la WABA.
const NOT_A_STATUS = new Set(["FLAGGED", "LOCKED", "UNARCHIVED"])

export function readTemplateStatus(
  change: WhatsappWabaChange
): WhatsappTemplateStatusEvent[] {
  const ref = readTemplateRef(change)
  const event = asString(change.value.event)?.trim().toUpperCase()
  if (!ref || !event) return []

  return [
    {
      ...ref,
      event,
      status: NOT_A_STATUS.has(event)
        ? null
        : // «Ya no está marcada ni deshabilitada y se puede volver a enviar».
          event === "REINSTATED"
          ? "APPROVED"
          : event,
      needsResync: event === "UNARCHIVED",
      category: readTemplateCategory(change.value.message_template_category),
      reason: readReason(change.value),
    },
  ]
}

// `reason` es `NONE` en todo lo que no es un rechazo. En una pausa el motivo
// útil va en `other_info.title` (`FIRST_PAUSE`, `SECOND_PAUSE`…).
function readReason(value: Record<string, unknown>): string | null {
  const reason = asString(value.reason)?.trim()
  if (reason && reason.toUpperCase() !== "NONE") return reason
  return asString(asRecord(value.other_info)?.title)?.trim() || null
}
