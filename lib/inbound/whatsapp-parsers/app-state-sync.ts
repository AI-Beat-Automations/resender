import { asArray, asRecord, asString, normalizeTimestamp } from "./coerce"
import type { WhatsappChange } from "./envelope"
import type { WhatsappContactSyncEvent } from "./types"

// `field: "smb_app_state_sync"`: la agenda del negocio, que en Coexistence
// llega por webhook cuando el dueño añade, edita o borra un contacto en el
// móvil.

export function readContactSync(
  change: WhatsappChange
): WhatsappContactSyncEvent[] {
  const events: WhatsappContactSyncEvent[] = []

  // El array se llama `state_sync[]`, no `contacts[]`.
  for (const raw of asArray(change.value.state_sync)) {
    const item = asRecord(raw)
    const contact = asRecord(item?.contact)
    const phoneNumber = asString(contact?.phone_number)
    const action = asString(item?.action)
    if (!phoneNumber || (action !== "add" && action !== "remove")) continue

    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      action,
      phoneNumber,
      // Ninguno de los dos viene en un `remove`.
      fullName: asString(contact?.full_name),
      firstName: asString(contact?.first_name),
      // `state_sync[].metadata` (con `timestamp`) no es `value.metadata` (con
      // `phone_number_id`), otra colisión de nombres de las de Meta.
      timestamp: normalizeTimestamp(asRecord(item?.metadata)?.timestamp),
    })
  }

  return events
}
