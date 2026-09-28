import { asString } from "./coerce"
import type { WhatsappWabaChange } from "./envelope"
import { readTemplateCategory, readTemplateRef } from "./template-ref"
import type { WhatsappTemplateCategoryEvent } from "./types"

// `field: "template_category_update"`: Meta recategorizó una plantilla, o avisa
// de que la va a recategorizar en 24 h.
//
// En las dos variantes `new_category` es la categoría **vigente** cuando llega
// el webhook: en el aviso todavía es la de hoy (y `correct_category` la que
// va a tener), en el cambio ya hecho es la nueva (y `previous_category` la de
// antes). Por eso escribir `new_category` en la copia es correcto siempre.

export function readTemplateCategoryUpdate(
  change: WhatsappWabaChange
): WhatsappTemplateCategoryEvent[] {
  const ref = readTemplateRef(change)
  if (!ref) return []

  return [
    {
      ...ref,
      category: readTemplateCategory(change.value.new_category),
      previousCategory: asString(change.value.previous_category),
      upcomingCategory: asString(change.value.correct_category),
    },
  ]
}
