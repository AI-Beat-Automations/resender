import { asString } from "./coerce"
import type { WhatsappWabaChange } from "./envelope"
import { readTemplateRef } from "./template-ref"
import type { WhatsappTemplateQualityEvent } from "./types"

// `field: "message_template_quality_update"`: la calidad de la plantilla pasó
// de un color a otro (`GREEN`, `YELLOW`, `RED`, `UNKNOWN`). No toca la copia ni
// se le avisa al tenant: va a logs, para enterarnos antes de que Meta pause la
// plantilla.

export function readTemplateQuality(
  change: WhatsappWabaChange
): WhatsappTemplateQualityEvent[] {
  const ref = readTemplateRef(change)
  if (!ref) return []

  return [
    {
      ...ref,
      previousQuality: asString(change.value.previous_quality_score),
      newQuality: asString(change.value.new_quality_score),
    },
  ]
}
