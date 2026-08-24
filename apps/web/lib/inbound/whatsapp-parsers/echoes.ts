import { asArray, asRecord, asString, normalizeTimestamp } from "./coerce"
import { interpretMessage } from "./content"
import type { WhatsappChange } from "./envelope"
import { readErrors } from "./envelope"
import type { WhatsappMessageEvent } from "./types"

// `field: "smb_message_echoes"`: lo que el negocio escribió desde la WhatsApp
// Business App o un dispositivo vinculado. Solo existe en Coexistence.

export function readEchoes(change: WhatsappChange): WhatsappMessageEvent[] {
  const events: WhatsappMessageEvent[] = []

  for (const raw of asArray(change.value.message_echoes)) {
    const echo = asRecord(raw)
    // **La dirección va al revés que en `messages[]`**: aquí `from` es el
    // número del negocio y `to` el del cliente. Leer `from` como si fuera el
    // contacto crearía una conversación del negocio consigo mismo.
    const from = asString(echo?.from)
    const to = asString(echo?.to)
    const metaMessageId = asString(echo?.id)
    if (!echo || !from || !to || !metaMessageId) continue

    const interpreted = interpretMessage(echo)
    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      direction: "outbound",
      contactId: to,
      senderId: from,
      contactName: null,
      metaMessageId,
      ...interpreted,
      replyToMetaMessageId: asString(asRecord(echo.context)?.id),
      // Distinguirlos de `resender_api` es lo que evita que el sistema se
      // automatice sobre sí mismo: un echo no es una respuesta nuestra.
      origin: "business_app",
      historical: false,
      deliveryStatus: null,
      errors: readErrors(echo.errors),
      createdAt: normalizeTimestamp(echo.timestamp),
    })
  }

  return events
}
