import type { InboundEvent } from "./inbound-event"

// Parser del webhook de **Instagram**, mensajes directos.
//
// El sobre se parece al de Messenger (`entry[].messaging[]`) pero el contenido
// no, y las diferencias son justamente las que rompen el sistema si se calcan:
//
// - **`is_echo`**: los mensajes que manda la propia cuenta vuelven como evento
//   entrante. Sin descartarlos, cada respuesta que enviamos se persiste como si
//   fuera un mensaje del contacto y se reenvía al webhook del tenant, que
//   típicamente contesta — y ahí la cuenta se responde a sí misma en bucle.
// - **`is_deleted`**: en Instagram el usuario puede deshacer el envío. Llega el
//   mismo `mid` marcado como borrado, y no es un mensaje nuevo.
// - **Los comentarios viajan en el mismo payload que los DMs**, en otra rama
//   del `entry`: plana (`entry.field` + `entry.value`) con Instagram Login, o en
//   `entry[].changes[]` con Facebook Login. Este parser solo mira `messaging`,
//   así que las ignora a las dos; de los comentarios se ocupa
//   `instagram-comments.ts`, que va contra otra tabla.
//
// No hay rama de postbacks a propósito: la cuenta se suscribe solo a `messages`
// y `comments` (ver `INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS`), así que un
// `messaging_postbacks` no puede llegar. Agregar la rama sería código muerto que
// aparenta cobertura.

type InstagramWebhookBody = {
  object?: unknown
  entry?: Array<{
    id?: unknown
    messaging?: Array<{
      sender?: { id?: unknown }
      recipient?: { id?: unknown }
      timestamp?: unknown
      message?: {
        mid?: unknown
        text?: unknown
        is_echo?: unknown
        is_deleted?: unknown
      }
    }>
  }>
}

export function extractInstagramDirectMessages(body: unknown): InboundEvent[] {
  if (!body || typeof body !== "object") return []

  const entries = (body as InstagramWebhookBody).entry ?? []
  const events: InboundEvent[] = []

  for (const entry of entries) {
    if (typeof entry.id !== "string") continue

    for (const event of entry.messaging ?? []) {
      const message = event.message
      if (!message) continue

      // Eco de un mensaje propio: es la salida volviendo, no una entrada.
      if (message.is_echo === true) continue
      // El usuario deshizo el envío; el `mid` ya se procesó cuando llegó.
      if (message.is_deleted === true) continue

      const text = message.text
      // Solo texto en el MVP. Un DM con adjunto y sin texto (una foto, una
      // respuesta a una historia) se descarta acá, igual que en Messenger.
      if (typeof text !== "string" || text.trim().length === 0) continue

      events.push({
        eventType: "message",
        // `entry.id` es el IG ID de la cuenta profesional que recibe, el mismo
        // que guardó el OAuth en `connected_pages.meta_page_id`. Se usa este y
        // no `recipient.id`: en un eco los dos se invierten, y aunque los ecos
        // ya quedaron filtrados arriba, apoyarse en el campo que no depende de
        // la dirección deja el parser correcto por construcción.
        metaPageId: entry.id,
        senderId:
          typeof event.sender?.id === "string" ? event.sender.id : "unknown",
        text: text.trim(),
        metaMessageId: typeof message.mid === "string" ? message.mid : null,
        postbackPayload: null,
        timestamp: normalizeTimestamp(event.timestamp),
      })
    }
  }

  return events
}

// Instagram manda milisegundos desde epoch. Ante un valor que no sirve se usa
// la hora de recepción: perder el orden de un mensaje es mucho menos grave que
// perder el mensaje, y un `Invalid Date` rompería el insert.
function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number") return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}
