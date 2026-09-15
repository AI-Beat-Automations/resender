// Evento entrante ya normalizado, **neutro al canal**. Es el contrato entre los
// parsers de webhook (uno por canal, porque los payloads no se parecen) y la
// ingesta (una sola, porque los gates, el dedupe, el contador y el reenvío al
// webhook del tenant sí son los mismos).
//
// Vive en su propio módulo y no en `meta-webhook.ts` porque desde Instagram hay
// dos productores: dejarlo del lado de Messenger haría que el parser de
// Instagram importara "el módulo de Messenger" para hablar de algo que no es de
// Messenger.

// Import **solo de tipos** y a propósito: `message-enums.ts` importa de aquí el
// valor `INBOUND_ATTACHMENT_TYPES`, así que un import normal cerraría un ciclo
// en tiempo de ejecución. `import type` se borra al compilar y el ciclo queda
// solo en el grafo de tipos, que TypeScript sí resuelve.
import type {
  AttachmentStatus,
  DeliveryStatus,
  MessageAttachmentType,
  MessageOrigin,
} from "@/lib/messages/message-enums"

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
  // Estado del binario, **solo en el sobre que sale al tenant**: lo agrega
  // `buildInboundPushPayload` derivándolo de la fila (`attachment_status` más
  // la edad, ver `lib/messages/media-retention.ts`). No se persiste aquí
  // dentro: la columna es la fuente y el jsonb sería una segunda copia.
  status?: AttachmentStatus
}

export type InboundAttachment = {
  // El catálogo ancho —el de la fila, no el de Messenger— porque WhatsApp
  // manda seis tipos que los otros dos canales no tienen (ubicación, contacto,
  // reacción, interactivo, pedido, evento de sistema) y el evento neutro es el
  // que los cruza. `MessageAttachmentType` **extiende** `INBOUND_ATTACHMENT_TYPES`
  // (ver `message-enums.ts`), así que nada de lo que ya producían Messenger e
  // Instagram deja de valer.
  type: MessageAttachmentType
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

  // ---------------------------------------------------------------------
  // Campos de WhatsApp. **Todos opcionales y todos aditivos**: Messenger e
  // Instagram no los escriben y la ingesta los lee con un default que es
  // exactamente el comportamiento que esos dos canales tienen hoy. Así los
  // tres canales siguen entrando por la misma puerta —los mismos gates, el
  // mismo dedupe, el mismo contador— en vez de tener una ingesta por canal.
  // ---------------------------------------------------------------------

  // Ausente = `inbound`, que es lo único que Messenger e Instagram producen.
  // WhatsApp sí manda salientes por webhook: el eco de lo que el negocio
  // tecleó en la Business App y la mitad saliente del historial.
  direction?: "inbound" | "outbound"
  // Quién produjo el mensaje. `direction` no alcanza en Coexistence: un
  // saliente puede ser nuestro (API) o un eco del negocio, y el webhook del
  // tenant necesita distinguirlos para no automatizarse sobre sí mismo.
  origin?: MessageOrigin
  // Backfill del sync inicial. Es la bandera que apaga el reenvío y la cuota
  // (única excepción declarada de la ADR 0011, ver `inbound-ingestion.ts`).
  historical?: boolean
  // Solo lo trae el historial, donde cada mensaje llega con el estado que ya
  // tenía en el móvil. En vivo el estado llega aparte, por `statuses[]`.
  deliveryStatus?: DeliveryStatus | null
  // Lo que hay que escribir en `attachment_status`, y por tanto también si se
  // encola una descarga: `pending` sí, `unavailable` no (Meta no ofrece el
  // binario del historial de más de 14 días), `null` no hay binario.
  attachmentStatus?: AttachmentStatus | null
  // El id de media de Meta, lo único con lo que se puede pedir la descarga
  // después. Va suelto y no dentro de `attachment` porque es un dato de
  // ingesta —el job de descarga— y no del sobre que sale al tenant.
  providerMediaId?: string | null
  // `context.id`: el mensaje al que este responde. Ojo, una reacción **no**
  // usa `context`; su vínculo viaja en `attachment.details`.
  replyToMetaMessageId?: string | null
}
