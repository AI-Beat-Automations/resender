import type { DeliveryStatus } from "@/lib/messages/message-enums"

import {
  asArray,
  asBoolean,
  asRecord,
  asString,
  normalizeTimestamp,
} from "./coerce"
import type { WhatsappChange } from "./envelope"
import { readErrors } from "./envelope"
import type { WhatsappStatusEvent, WhatsappStatusPricing } from "./types"

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
      pricing: readPricing(status.pricing),
    })
  }

  return events
}

// El bloque `pricing` que acompaña a `sent` y `delivered`: el dato con el que
// Meta cobra los mensajes de servicio desde el 1 de octubre de 2026 (ADR 0023).
//
// `billable` es lo único obligatorio: sin él el bloque no dice lo que importa y
// se trata como ausente. El resto va tal cual llega y sin validar contra una
// lista, por la misma razón que las columnas no tienen CHECK (0029): Meta
// añade valores sin cambiar de versión de API, y descartar el cobro de un
// mensaje por una categoría nueva sería perder justo el dato que se cuenta.
function readPricing(value: unknown): WhatsappStatusPricing | null {
  const pricing = asRecord(value)
  const billable = asBoolean(pricing?.billable)
  if (!pricing || billable === null) return null

  return {
    billable,
    category: asString(pricing.category),
    type: asString(pricing.type),
    pricingModel: asString(pricing.pricing_model),
  }
}
