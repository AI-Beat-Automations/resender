// Evento entrante ya normalizado, **neutro al canal**. Es el contrato entre los
// parsers de webhook (uno por canal, porque los payloads no se parecen) y la
// ingesta (una sola, porque los gates, el dedupe, el contador y el reenvío al
// webhook del tenant sí son los mismos).
//
// Vive en su propio módulo y no en `meta-webhook.ts` porque desde Instagram hay
// dos productores: dejarlo del lado de Messenger haría que el parser de
// Instagram importara "el módulo de Messenger" para hablar de algo que no es de
// Messenger.

export type InboundEventType = "message" | "postback"

// Catálogo completo de tipos de adjunto que Meta puede mandar en un mensaje
// entrante, más `unknown` para lo que Meta invente después: un tipo nuevo no se
// pierde, entra como `unknown` con su nombre real en `details.rawType`. Este
// mismo catálogo es el que valida el check `messages_attachment_type_check` de
// la migración 0016 — si se agrega un tipo acá hay que agregarlo también allá.
export const INBOUND_ATTACHMENT_TYPES = [
  "image",
  "audio",
  "video",
  "file",
  "sticker",
  "reel",
  "ig_reel",
  "post",
  "ig_post",
  "fallback",
  "appointment_booking",
  "template",
  "unknown",
] as const
export type InboundAttachmentType = (typeof INBOUND_ATTACHMENT_TYPES)[number]

export type AttachmentBookingDetails = {
  bookingId: string
  status: string | null
  startTime: number | null
  endTime: number | null
  timezone: string | null
}

export type AttachmentProductElement = {
  id: string | null
  retailerId: string | null
  imageUrl: string | null
  title: string | null
  subtitle: string | null
}

// Claves opcionales y no unión discriminada a propósito: el consumidor hace
// details.stickerId sin guardas y un tipo nuevo de Meta suma una clave adentro
// sin cambiar la forma para nadie.
export type AttachmentDetails = {
  droppedCount?: number
  stickerId?: string
  reelVideoId?: string
  postId?: string
  booking?: AttachmentBookingDetails
  elements?: AttachmentProductElement[]
  rawType?: string
  raw?: unknown
}

export type InboundAttachment = {
  type: InboundAttachmentType
  url: string | null
  title: string | null
  details: AttachmentDetails
}

export type InboundEvent = {
  eventType: InboundEventType
  // Id de la cuenta que recibe, tal como llega en `entry.id`: page id en
  // Messenger, IG ID de la cuenta profesional en Instagram. Se resuelve contra
  // `connected_pages` junto con el canal, que lo aporta el llamador.
  metaPageId: string
  senderId: string
  // Sigue siendo string: `""` cuando el mensaje no trajo texto (por ejemplo un
  // adjunto solo). El XOR texto/adjunto es una regla de salida, no de entrada.
  text: string
  // A lo sumo uno por evento: Meta puede mandar varios, pero se persiste una
  // columna por mensaje y el primero es el que el contacto mandó primero. Los
  // demás quedan contados en `details.droppedCount`.
  attachment: InboundAttachment | null
  metaMessageId: string | null
  postbackPayload: string | null
  timestamp: Date
}
