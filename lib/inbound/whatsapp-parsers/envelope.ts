import { asArray, asRecord, asString, asNumber } from "./coerce"
import type { WhatsappError } from "./types"

// El sobre del webhook de WhatsApp **no** es `entry[].messaging[]` como
// Messenger e Instagram, sino `entry[].changes[].value`, y el mismo POST puede
// agregar hasta 1000 updates de campos distintos. Por eso todo se itera y nada
// asume `entry[0]`.

export type WhatsappChange = {
  wabaId: string | null
  field: string
  value: Record<string, unknown>
  providerPhoneNumberId: string
  // `metadata.display_phone_number`, el número del negocio. Solo se usa para
  // deducir la dirección de los mensajes del historial que llegan sin hilo.
  businessPhoneNumber: string | null
}

// Los `field`s de la WABA y no de un número: el estado, la categoría y la
// calidad de una plantilla. Llegan **sin `value.metadata`** —la plantilla es de
// la WABA, no de ningún `phone_number_id`— y por eso no pasan por
// `collectChanges`, que sin número descarta el cambio.
export const WHATSAPP_WABA_FIELDS = [
  "message_template_status_update",
  "template_category_update",
  "message_template_quality_update",
] as const

export type WhatsappWabaField = (typeof WHATSAPP_WABA_FIELDS)[number]

export type WhatsappWabaChange = {
  // Obligatorio acá, a diferencia de `WhatsappChange`: sin número, el WABA es
  // lo único que dice de quién es la plantilla.
  wabaId: string
  field: WhatsappWabaField
  value: Record<string, unknown>
  // `entry[].time`, en segundos. Es la única hora que traen estos payloads.
  time: unknown
}

export function isWhatsappWabaField(field: string): field is WhatsappWabaField {
  return (WHATSAPP_WABA_FIELDS as readonly string[]).includes(field)
}

export function collectChanges(body: unknown): WhatsappChange[] {
  const root = asRecord(body)
  if (!root) return []

  const changes: WhatsappChange[] = []
  for (const rawEntry of asArray(root.entry)) {
    const entry = asRecord(rawEntry)
    // Un `entry` que no tiene forma de objeto no lleva `changes` que recorrer:
    // eso sí es basura y se descarta. **La falta de `entry.id` no lo es.** El
    // WABA no enruta nada —de eso se encarga `metadata.phone_number_id`— y
    // nadie lo consume aguas abajo, así que tirar el `entry` entero por él
    // significaría perder todos sus mensajes reales, sin un solo log, por un
    // campo decorativo. Basta con que llegue en null; `asString` ya lo deja así
    // cuando Meta lo manda como número en vez de como string.
    if (!entry) continue
    const wabaId = asString(entry.id)

    for (const rawChange of asArray(entry.changes)) {
      const change = asRecord(rawChange)
      // `field` no se adivina a partir de la forma del `value` aunque falte.
      // `messages[]` significa "mensaje entrante" bajo `field: "messages"` y
      // "ID de media del historial" bajo `field: "history"`, y confundirlos
      // haría que un mensaje de hace seis meses abriera la ventana de 24 h y se
      // reenviara al webhook del tenant como si acabara de llegar. Descartar es
      // peor que acertar, pero mucho mejor que equivocarse callado.
      const field = asString(change?.field)
      const value = asRecord(change?.value)
      if (!field || !value) continue
      // Los de la WABA los recoge `collectWabaChanges`.
      if (isWhatsappWabaField(field)) continue

      const metadata = asRecord(value.metadata)
      const providerPhoneNumberId = asString(metadata?.phone_number_id)
      // Sin `phone_number_id` no hay número conectado al que atribuir el
      // evento, y por tanto tampoco tenant: no hay nada que hacer con él.
      if (!providerPhoneNumberId) continue

      changes.push({
        wabaId,
        field,
        value,
        providerPhoneNumberId,
        businessPhoneNumber: asString(metadata?.display_phone_number),
      })
    }
  }

  return changes
}

// El recorrido de los cambios de la WABA. Mismo sobre, otra regla de descarte:
// acá lo que no puede faltar es el `entry.id`, porque sin WABA no hay copia que
// actualizar ni conexiones a las que avisar.
export function collectWabaChanges(body: unknown): WhatsappWabaChange[] {
  const root = asRecord(body)
  if (!root) return []

  const changes: WhatsappWabaChange[] = []
  for (const rawEntry of asArray(root.entry)) {
    const entry = asRecord(rawEntry)
    const wabaId = asString(entry?.id)
    if (!entry || !wabaId) continue

    for (const rawChange of asArray(entry.changes)) {
      const change = asRecord(rawChange)
      const field = asString(change?.field)
      const value = asRecord(change?.value)
      if (!field || !value || !isWhatsappWabaField(field)) continue
      changes.push({ wabaId, field, value, time: entry.time })
    }
  }

  return changes
}

// El mismo aplanado sirve para los errores de un mensaje `unsupported`, los de
// un status `failed` y los de un chunk de historial rechazado: Meta usa la
// misma forma en los tres sitios.
export function readErrors(value: unknown): WhatsappError[] {
  return asArray(value).flatMap((raw) => {
    const error = asRecord(raw)
    if (!error) return []
    return [
      {
        code: asNumber(error.code),
        title: asString(error.title),
        message: asString(error.message),
        details: asString(asRecord(error.error_data)?.details),
      },
    ]
  })
}
