import type { WhatsappTemplateCategory } from "@/lib/meta/whatsapp-template-client"

import { asNumber, asString, normalizeTimestamp } from "./coerce"
import type { WhatsappWabaChange } from "./envelope"
import type { WhatsappTemplateRef } from "./types"

// Lo común a los tres webhooks de plantillas: el mismo trío
// `message_template_id` / `_name` / `_language` y el WABA del `entry`.

export function readTemplateRef(
  change: WhatsappWabaChange
): WhatsappTemplateRef | null {
  const value = change.value
  const name = asString(value.message_template_name)?.trim()
  const language = asString(value.message_template_language)?.trim()
  // Sin nombre e idioma no hay a qué fila aplicarle nada, aunque venga el id:
  // la fila nueva que se crea cuando la copia no la conoce los necesita.
  if (!name || !language) return null

  return {
    wabaId: change.wabaId,
    metaTemplateId: readTemplateId(value.message_template_id),
    name,
    language: normalizeTemplateLanguage(language),
    timestamp: normalizeTimestamp(change.time),
  }
}

// Número en el JSON de Meta; string si algún día cambia de idea, como pasó con
// otros ids.
function readTemplateId(value: unknown): string | null {
  const numeric = asNumber(value)
  if (numeric !== null) return String(numeric)
  return asString(value)?.trim() || null
}

// El listado de Graph —de donde sale la copia— devuelve `en_US`; los ejemplos
// de los webhooks, `en-US`. Se guarda y se busca siempre con guion bajo.
export function normalizeTemplateLanguage(language: string): string {
  return language.replace(/-/g, "_")
}

// Mayúsculas en el webhook (`UTILITY`), minúsculas en la columna. Lo que no es
// una de las tres vuelve null: la columna tiene check y no se toca.
export function readTemplateCategory(
  value: unknown
): WhatsappTemplateCategory | null {
  const category = asString(value)?.trim().toLowerCase()
  return category === "utility" ||
    category === "marketing" ||
    category === "authentication"
    ? category
    : null
}
