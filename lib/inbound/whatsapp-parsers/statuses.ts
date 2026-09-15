import type { DeliveryStatus } from "@/lib/messages/message-enums"

import { asArray, asRecord, asString, normalizeTimestamp } from "./coerce"
import type { WhatsappChange } from "./envelope"
import { readErrors } from "./envelope"
import type { WhatsappStatusEvent } from "./types"

// `field: "messages"`, mitad saliente: los acuses de entrega de lo que
// enviamos nosotros.

const DELIVERY_STATUS_BY_REPORTED: Record<string, DeliveryStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  // Meta emite `played` la primera vez que se reproduce una nota de voz. No
  // está en el CHECK de `delivery_status` (0017 §5) y es monotónicamente
  // equivalente a `read`: el usuario abrió el chat y consumió el mensaje. Se
  // mapea en vez de añadir el valor porque una migración cuyo único aporte es
  // un estado que ninguna vista distingue no se paga sola.
  //
  // `deleted` se queda en el enum aunque Meta no lo emita nunca por aquí: el
  // borrado llega por otra puerta, el `revoke` de los echoes de Coexistence.
  played: "read",
  failed: "failed",
}

export function readStatuses(change: WhatsappChange): WhatsappStatusEvent[] {
  const events: WhatsappStatusEvent[] = []

  for (const raw of asArray(change.value.statuses)) {
    const status = asRecord(raw)
    const metaMessageId = asString(status?.id)
    const reported = asString(status?.status)
    if (!status || !metaMessageId || !reported) continue

    const deliveryStatus = DELIVERY_STATUS_BY_REPORTED[reported]
    // Un valor que no sabemos mapear se descarta en vez de inventarle uno: la
    // columna tiene un CHECK y un valor de relleno rompería el insert de todo
    // el lote. Meta añade valores sin cambiar de versión de API, así que este
    // camino se recorrerá antes o después.
    if (!deliveryStatus) continue

    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      metaMessageId,
      deliveryStatus,
      recipientId: asString(status.recipient_id),
      timestamp: normalizeTimestamp(status.timestamp),
      errors: readErrors(status.errors),
    })
  }

  return events
}
