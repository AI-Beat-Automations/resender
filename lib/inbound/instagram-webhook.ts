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

type InstagramMessagingEvent = {
  sender?: { id?: unknown }
  recipient?: { id?: unknown }
  timestamp?: unknown
  message?: {
    mid?: unknown
    text?: unknown
    is_echo?: unknown
    is_deleted?: unknown
  }
}

type InstagramWebhookBody = {
  object?: unknown
  entry?: Array<{
    id?: unknown
    messaging?: InstagramMessagingEvent[]
  }>
}

// Por qué el parser deja pasar un evento de `messaging` sin producir nada.
// Todos son descartes **a propósito**; lo que no cae en ninguno es un payload
// que el parser no reconoce, y eso sí es una alarma.
export type IgnoredInstagramKind =
  | "echo" // la salida volviendo: un mensaje de la propia cuenta
  | "deleted" // el contacto deshizo el envío
  | "non_text" // foto, sticker, ❤️ o respuesta a una historia, sin texto
  | "no_message" // visto, reacción: el evento no trae `message`

type Classified =
  | { kind: "message"; text: string }
  | { kind: "ignored"; reason: IgnoredInstagramKind }

// Una sola clasificación para el parser y para el conteo de ignorados: si
// fueran dos, un descarte nuevo en una y no en la otra volvería a esconder la
// alarma o a dispararla de más.
function classify(event: InstagramMessagingEvent): Classified {
  const message = event.message
  if (!message) return { kind: "ignored", reason: "no_message" }

  // Eco de un mensaje propio: es la salida volviendo, no una entrada.
  if (message.is_echo === true) return { kind: "ignored", reason: "echo" }
  // El usuario deshizo el envío; el `mid` ya se procesó cuando llegó.
  if (message.is_deleted === true) return { kind: "ignored", reason: "deleted" }

  const text = message.text
  // Solo texto en este parser. Un DM con adjunto y sin texto (una foto,
  // una respuesta a una historia) se descarta acá. Messenger ya los
  // acepta (issue #46); habilitarlos en Instagram queda para otro issue.
  if (typeof text !== "string" || text.trim().length === 0) {
    return { kind: "ignored", reason: "non_text" }
  }
  return { kind: "message", text: text.trim() }
}

export function extractInstagramDirectMessages(body: unknown): InboundEvent[] {
  if (!body || typeof body !== "object") return []

  const entries = (body as InstagramWebhookBody).entry ?? []
  const events: InboundEvent[] = []

  for (const entry of entries) {
    if (typeof entry.id !== "string") continue

    for (const event of entry.messaging ?? []) {
      const classified = classify(event)
      if (classified.kind === "ignored") continue
      const message = event.message

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
        text: classified.text,
        // Siempre null mientras este parser descarte los adjuntos (ver arriba).
        attachment: null,
        metaMessageId: typeof message?.mid === "string" ? message.mid : null,
        postbackPayload: null,
        timestamp: normalizeTimestamp(event.timestamp),
      })
    }
  }

  return events
}

// Los eventos de `messaging` que el parser ignoró a propósito, y por qué. Es lo
// que le permite a la ruta separar un sobre de puros «visto» o ecos —ruido
// normal— de uno que el parser no reconoce. Solo cuenta entradas con `id`
// válido: una entrada sin `id` es un payload raro y tiene que seguir sonando.
export function describeIgnoredInstagramMessaging(body: unknown): {
  ignoredCount: number
  ignoredKinds: IgnoredInstagramKind[]
} {
  const kinds = new Set<IgnoredInstagramKind>()
  let ignoredCount = 0
  if (body && typeof body === "object") {
    for (const entry of (body as InstagramWebhookBody).entry ?? []) {
      if (typeof entry?.id !== "string") continue
      for (const event of entry.messaging ?? []) {
        const classified = classify(event)
        if (classified.kind !== "ignored") continue
        ignoredCount += 1
        kinds.add(classified.reason)
      }
    }
  }
  return { ignoredCount, ignoredKinds: [...kinds].sort() }
}

// Instagram manda milisegundos desde epoch. Ante un valor que no sirve se usa
// la hora de recepción: perder el orden de un mensaje es mucho menos grave que
// perder el mensaje, y un `Invalid Date` rompería el insert.
function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number") return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}
