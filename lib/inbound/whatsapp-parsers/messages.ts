import {
  asArray,
  asRecord,
  asString,
  digitsOf,
  normalizeTimestamp,
} from "./coerce"
import { interpretMessage } from "./content"
import type { WhatsappChange } from "./envelope"
import { readErrors } from "./envelope"
import type { WhatsappMessageEvent } from "./types"

// `field: "messages"`, mitad entrante. La otra mitad del mismo `field` son los
// acuses de lo que enviamos nosotros y vive en `statuses.ts`: llegan en dos
// arrays independientes que pueden venir a la vez o faltar los dos (un `value`
// con solo `errors` es legal).

export function readInboundMessages(
  change: WhatsappChange
): WhatsappMessageEvent[] {
  const profileNames = readProfileNames(change.value.contacts)
  const events: WhatsappMessageEvent[] = []

  for (const raw of asArray(change.value.messages)) {
    const message = asRecord(raw)
    const from = asString(message?.from)
    const metaMessageId = asString(message?.id)
    if (!message || !from || !metaMessageId) continue

    const interpreted = interpretMessage(message)
    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      direction: "inbound",
      contactId: from,
      senderId: from,
      contactName: profileNames.get(digitsOf(from)) ?? null,
      metaMessageId,
      ...interpreted,
      replyToMetaMessageId: asString(asRecord(message.context)?.id),
      // Un `user_changed_number` no lo escribió el cliente: lo genera WhatsApp
      // cuando alguien se cambia de número. Marcarlo como `customer` lo metería
      // en la conversación como si el contacto hubiera hablado, y además
      // abriría la ventana de 24 h sin que nadie haya hablado.
      origin: interpreted.attachment?.type === "system" ? "system" : "customer",
      historical: false,
      deliveryStatus: null,
      errors: readErrors(message.errors),
      createdAt: normalizeTimestamp(message.timestamp),
    })
  }

  return events
}

// `value.contacts[]` (el perfil de quien escribe) no tiene nada que ver con
// `messages[].contacts[]` (una tarjeta de contacto compartida): mismo nombre,
// significados opuestos. Y no siempre viene aunque haya mensajes — el ejemplo
// oficial de `system` llega sin él.
function readProfileNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>()
  for (const raw of asArray(value)) {
    const contact = asRecord(raw)
    const waId = asString(contact?.wa_id)
    const name = asString(asRecord(contact?.profile)?.name)
    // Se indexa por dígitos porque las tablas de Meta documentan `wa_id` sin
    // `+` y `from` con `+`, mientras que sus propios ejemplos JSON los mandan
    // los dos sin `+`. Comparar en crudo dejaría sin nombre a media base de
    // contactos el día que la doc deje de contradecirse.
    if (waId && name) names.set(digitsOf(waId), name)
  }
  return names
}
