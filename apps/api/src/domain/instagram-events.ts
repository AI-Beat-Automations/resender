export type InboundInstagramMessage = {
  // `entry.id`: el IG ID de la cuenta profesional que recibe.
  providerAccountId: string
  senderId: string
  text: string
  providerMessageId: string
  createdAt: Date
}

type InstagramWebhookBody = {
  entry?: Array<{
    id?: unknown
    time?: unknown
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

// Parser de los **mensajes directos** de Instagram. Comparte el sobre
// `entry[].messaging[]` con Messenger, y ahí se termina el parecido: por eso hay
// un parser por canal y una sola ingesta. Lo que sí es común —dedupe por
// índice, resolución cuenta→tenant, gates, bitácora de entregas y reintentos—
// no se duplica.
//
// Los comentarios viajan en el **mismo payload**, en otra rama; los parsea
// `extractInstagramComments`.
export function extractInstagramDirectMessages(
  value: unknown
): InboundInstagramMessage[] {
  if (!value || typeof value !== "object") return []
  const events: InboundInstagramMessage[] = []

  for (const entry of (value as InstagramWebhookBody).entry ?? []) {
    if (typeof entry.id !== "string") continue

    for (const item of entry.messaging ?? []) {
      const message = item.message
      if (!message) continue

      // **El filtro anti-bucle.** Los mensajes que manda la propia cuenta
      // vuelven como evento entrante. Sin descartarlos, cada respuesta que
      // envía Resender se persiste como si fuera del contacto y se reenvía al
      // webhook del tenant, que típicamente contesta: la cuenta termina
      // hablando sola.
      if (message.is_echo === true) continue

      // En Instagram el usuario puede deshacer el envío. Llega el mismo `mid`
      // marcado como borrado, y eso no es un mensaje nuevo.
      if (message.is_deleted === true) continue

      const senderId =
        typeof item.sender?.id === "string" ? item.sender.id : null
      if (!senderId) continue
      if (typeof message.mid !== "string") continue
      const text = typeof message.text === "string" ? message.text.trim() : ""
      if (!text) continue

      events.push({
        // La cuenta receptora se toma de `entry.id` y no de `recipient.id`: en
        // un eco los dos se invierten. Aunque los ecos ya quedaron filtrados,
        // apoyarse en el campo que no depende de la dirección deja el parser
        // correcto por construcción.
        providerAccountId: entry.id,
        senderId,
        text,
        providerMessageId: message.mid,
        createdAt: normalizeTimestamp(item.timestamp),
      })
    }
  }

  return events
}

// No hay rama de postbacks a propósito, a diferencia del parser de Messenger:
// la cuenta se suscribe solo a `messages` y `comments`, así que un
// `messaging_postbacks` no puede llegar. Escribirla sería código muerto que
// aparenta cobertura.
function normalizeTimestamp(value: unknown): Date {
  if (typeof value !== "number") return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}
