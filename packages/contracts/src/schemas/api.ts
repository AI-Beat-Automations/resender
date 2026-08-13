import { z } from "zod"

import {
  CursorSchema,
  IsoDateSchema,
  LimitSchema,
  PaginationSchema,
  UuidSchema,
} from "./common"

export const PlanLookupKeySchema = z.enum(["starter_monthly", "pro_monthly"])

export const MeSchema = z.object({
  tenantId: UuidSchema,
  plan: z.object({
    status: z.string(),
    lookupKey: PlanLookupKeySchema,
  }),
})

export const PageStatusSchema = z.enum(["active", "disconnected"])
export const PageTokenStatusSchema = z.enum(["valid", "invalid"])

// El canal es un campo aparte de `provider` y no un valor suyo. Instagram **es**
// Meta: comparten la app, el sobre de error de Graph y la firma del webhook. Lo
// que cambia es la superficie —Página de Facebook contra cuenta profesional de
// Instagram—, y meterlo en `provider` habría obligado a que el día que exista
// un proveedor que no sea Meta las dos dimensiones se pisen.
export const ChannelSchema = z.enum(["messenger", "instagram", "whatsapp"])

export const PageSchema = z.object({
  id: UuidSchema,
  provider: z.literal("meta"),
  channel: ChannelSchema,
  providerPageId: z.string(),
  name: z.string(),
  // El @handle. Solo Instagram lo tiene; en Messenger va null. Siempre presente
  // para que el consumidor no tenga que ramificar por canal para leerlo.
  username: z.string().nullable(),
  // Identidad de WhatsApp, con el mismo criterio que `username`: campos planos,
  // siempre presentes y null fuera de su canal. `providerPageId` ya es el
  // phone_number_id; acá va lo que ese ID no cuenta: a qué WABA pertenece, el
  // número legible por humanos y cómo se conectó. `coexistence`/`historySync`
  // reportan el progreso que Meta informa por webhook y no tienen enum cerrado
  // porque los valores los define Meta, no Resender.
  wabaId: z.string().nullable(),
  phoneE164: z.string().nullable(),
  onboardingMode: z.enum(["standard", "coexistence"]).nullable(),
  whatsappStatus: z
    .object({
      coexistence: z.string().nullable(),
      historySync: z.string().nullable(),
    })
    .nullable(),
  status: PageStatusSchema,
  tokenStatus: PageTokenStatusSchema,
  webhook: z.object({
    url: z.url().nullable(),
    signingEnabled: z.boolean(),
  }),
  connectedAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})

export const PageListQuerySchema = z.object({
  channel: ChannelSchema.optional(),
  status: PageStatusSchema.optional(),
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
})

export const PageUpdateSchema = z.object({
  webhookUrl: z.url().nullable(),
})

export const WebhookSecretSchema = z.object({
  secret: z.string().startsWith("whsec_"),
  createdAt: IsoDateSchema,
})

export const MessageDirectionSchema = z.enum(["inbound", "outbound"])
export const MessageStatusSchema = z.enum(["received", "sent", "failed"])

// `system`, `order` y `unknown` existen para que un webhook con un tipo que
// Resender no modela no se pierda ni se disfrace de texto: se conserva como
// evento genérico con su payload en `content`.
export const MessageTypeSchema = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "contacts",
  "location",
  "reaction",
  "interactive",
  "system",
  "order",
  "unknown",
])

// Quién produjo el mensaje. `direction` no alcanza en Coexistence: un outbound
// puede venir de la API de Resender o ser el echo de algo tecleado en la
// WhatsApp Business App, y el webhook externo necesita distinguirlos para no
// automatizar sobre sí mismo. `history` marca lo importado en la sync inicial.
export const MessageOriginSchema = z.enum([
  "customer",
  "resender_api",
  "business_app",
  "history",
  "system",
])

// Estado que reporta el proveedor por status webhook, separado del `status`
// interno (`received|sent|failed`): "Meta lo aceptó" y "el destinatario lo
// leyó" son hechos distintos y mezclarlos en un solo campo pierde uno de los
// dos. Null mientras el proveedor no haya dicho nada.
export const DeliveryStatusSchema = z.enum([
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
])

export const AttachmentKindSchema = z.enum([
  "image",
  "audio",
  "video",
  "document",
  "sticker",
])

export const AttachmentStatusSchema = z.enum([
  "pending",
  "available",
  "failed",
  "deleted",
])

export const AttachmentSchema = z.object({
  id: UuidSchema,
  kind: AttachmentKindSchema,
  mimeType: z.string(),
  filename: z.string().nullable(),
  caption: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  status: AttachmentStatusSchema,
  // URL de descarga autenticada con la API key del tenant. Solo se informa con
  // `status === "available"`: nunca es la URL temporal de Meta ni una firma
  // pública permanente.
  downloadUrl: z.url().nullable(),
})

// Payload tipado de los mensajes que no son texto ni adjunto. Union
// discriminada por `kind` para que agregar un tipo nuevo no cambie el shape de
// los existentes. `generic_event` conserva los eventos que Cloud API emite y
// Resender no modela (`system`, `order`, tipos futuros); `raw` es el payload ya
// filtrado de tokens y URLs temporales de Meta.
export const MessageContentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("location"),
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().nullable(),
    address: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("contacts"),
    contacts: z.array(
      z.object({
        name: z.string(),
        phones: z.array(z.string()),
        raw: z.unknown(),
      })
    ),
  }),
  z.object({
    kind: z.literal("reaction"),
    // Null cuando el usuario quita la reacción: Meta manda el evento sin emoji.
    emoji: z.string().nullable(),
    targetProviderMessageId: z.string(),
  }),
  z.object({
    kind: z.literal("interactive"),
    interactiveType: z.string(),
    payload: z.unknown(),
  }),
  z.object({
    kind: z.literal("generic_event"),
    eventType: z.string(),
    raw: z.unknown(),
  }),
])

export const MessageSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  pageId: UuidSchema,
  contactId: z.string(),
  direction: MessageDirectionSchema,
  status: MessageStatusSchema,
  type: MessageTypeSchema,
  // Texto del mensaje o caption del adjunto. Null cuando el tipo no lleva
  // texto (ubicación, sticker, reacción): inventarle un string vacío haría
  // indistinguible "sin texto" de "texto vacío" para el consumidor.
  text: z.string().nullable(),
  content: MessageContentSchema.nullable(),
  attachments: z.array(AttachmentSchema),
  origin: MessageOriginSchema,
  // True en lo importado por la sync de Coexistence. Un mensaje histórico no
  // abre ventana de 24 h ni se reenvía al webhook externo.
  historical: z.boolean(),
  deliveryStatus: DeliveryStatusSchema.nullable(),
  // Contexto de reply: el mensaje del proveedor al que este responde.
  replyTo: z.object({ providerMessageId: z.string() }).nullable(),
  provider: z.object({
    name: z.literal("meta"),
    messageId: z.string().nullable(),
  }),
  failure: z
    .object({
      message: z.string(),
    })
    .nullable(),
  // Informado solo en una respuesta privada a un comentario de Instagram: es el
  // comentario que la originó, y lo único que distingue ese DM de uno normal.
  //
  // El canal **no** está acá a propósito. Un mensaje es una proyección de la
  // tabla `messages` y el canal vive en `connected_pages`; agregarlo obligaría a
  // un join en cada lectura de mensaje para un dato que ya se resuelve una vez
  // por `pageId`.
  sourceCommentId: z.string().nullable(),
  createdAt: IsoDateSchema,
})

export const ConversationSchema = z.object({
  id: UuidSchema,
  page: z.object({
    id: UuidSchema,
    providerPageId: z.string(),
    name: z.string(),
  }),
  contact: z.object({
    id: z.string(),
    name: z.string().nullable(),
  }),
  latestMessage: MessageSchema.pick({
    id: true,
    text: true,
    direction: true,
    status: true,
    createdAt: true,
  }).nullable(),
  lastMessageAt: IsoDateSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})

export const ConversationListQuerySchema = z.object({
  pageId: UuidSchema.optional(),
  updatedAfter: IsoDateSchema.optional(),
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
})

export const MessageListQuerySchema = z.object({
  pageId: UuidSchema.optional(),
  conversationId: UuidSchema.optional(),
  direction: MessageDirectionSchema.optional(),
  status: MessageStatusSchema.optional(),
  createdAfter: IsoDateSchema.optional(),
  createdBefore: IsoDateSchema.optional(),
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
})

export const ThreadMessageListQuerySchema = z.object({
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
})

const SendMessageBaseSchema = z.object({
  pageId: UuidSchema,
  recipientId: z.string().trim().min(1).max(255),
  conversationId: UuidSchema.optional(),
  // Reply context: el id del proveedor (wamid) del mensaje al que se responde.
  replyToProviderMessageId: z.string().trim().min(1).optional(),
})

// El techo de 2000 es el de Messenger. Instagram corta antes y en otra unidad
// —1000 **bytes** UTF-8—, pero el esquema no sabe a qué canal apunta el
// `pageId`, así que ese límite se aplica en el servicio una vez resuelta la
// cuenta. Acá queda el máximo absoluto que ningún canal supera.
const SendTextMessageSchema = SendMessageBaseSchema.extend({
  type: z.literal("text"),
  text: z.string().trim().min(1).max(2000),
})

// El media saliente siempre referencia un upload previo (`/v1/media/uploads`),
// nunca una URL arbitraria del cliente: una URL externa es un vector de SSRF,
// puede caducar antes del envío y su contenido puede cambiar después de
// calcular la idempotencia. El techo de 1024 del caption es el de Cloud API.
const SendCaptionedMediaSchema = SendMessageBaseSchema.extend({
  type: z.enum(["image", "video", "document"]),
  mediaId: UuidSchema,
  caption: z.string().trim().min(1).max(1024).optional(),
})

// Audio, nota de voz y sticker no admiten caption en Cloud API, así que la
// variante no lo declara y zod lo stripea como a cualquier llave desconocida,
// igual que en el resto de la API pública.
const SendPlainMediaSchema = SendMessageBaseSchema.extend({
  type: z.enum(["audio", "sticker"]),
  mediaId: UuidSchema,
})

const SendLocationMessageSchema = SendMessageBaseSchema.extend({
  type: z.literal("location"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().min(1).max(1000).optional(),
  address: z.string().trim().min(1).max(1000).optional(),
})

const SendReactionMessageSchema = SendMessageBaseSchema.extend({
  type: z.literal("reaction"),
  targetProviderMessageId: z.string().trim().min(1),
  // Vacío quita la reacción, igual que en Cloud API.
  emoji: z.string().max(16),
})

const SendContactsMessageSchema = SendMessageBaseSchema.extend({
  type: z.literal("contacts"),
  contacts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        phones: z.array(z.string().trim().min(1).max(64)).min(1),
      })
    )
    .min(1)
    .max(20),
})

export const SendMessageSchema = z.discriminatedUnion("type", [
  SendTextMessageSchema,
  SendCaptionedMediaSchema,
  SendPlainMediaSchema,
  SendLocationMessageSchema,
  SendReactionMessageSchema,
  SendContactsMessageSchema,
])

export const MediaUploadStatusSchema = z.enum([
  "reserved",
  "uploaded",
  "completed",
  "consumed",
  "expired",
])

export const CreateMediaUploadSchema = z.object({
  kind: AttachmentKindSchema,
  // El catálogo de MIME/tamaños permitidos por Cloud API vive en el servicio,
  // versionado junto a la versión de Graph soportada; el esquema solo exige que
  // venga declarado.
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  filename: z.string().trim().min(1).max(255).optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
})

export const MediaUploadSchema = z.object({
  id: UuidSchema,
  kind: AttachmentKindSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nullable(),
  filename: z.string().nullable(),
  status: MediaUploadStatusSchema,
  expiresAt: IsoDateSchema,
  createdAt: IsoDateSchema,
})

export const CommentDirectionSchema = z.enum(["inbound", "outbound"])
export const CommentStatusSchema = z.enum(["received", "sent", "failed"])

// Un comentario no es un mensaje: cuelga de una publicación, se anida y su
// respuesta pública no tiene ventana de 24 horas. Tiene tabla propia
// (`instagram_comments`, migración 0013) y por lo mismo recurso propio.
export const CommentSchema = z.object({
  id: UuidSchema,
  pageId: UuidSchema,
  // Null en un saliente que Meta rechazó: no llegó a publicarse, así que no hay
  // id del lado de Instagram.
  providerCommentId: z.string().nullable(),
  // El comentario al que este responde. Null si es raíz.
  parentCommentId: z.string().nullable(),
  mediaId: z.string(),
  mediaProductType: z.string().nullable(),
  from: z.object({
    providerUserId: z.string(),
    username: z.string().nullable(),
  }),
  direction: CommentDirectionSchema,
  status: CommentStatusSchema,
  text: z.string(),
  failure: z.object({ message: z.string() }).nullable(),
  createdAt: IsoDateSchema,
})

export const CommentListQuerySchema = z.object({
  pageId: UuidSchema.optional(),
  mediaId: z.string().min(1).max(255).optional(),
  direction: CommentDirectionSchema.optional(),
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
})

// Instagram admite 2200 caracteres en un comentario, el mismo techo que un pie
// de foto. Se mide en caracteres, al revés que el DM.
export const CommentReplySchema = z.object({
  text: z.string().trim().min(1).max(2200),
})

// La respuesta privada es un DM y por eso hereda el techo de los mensajes. El
// límite real de Instagram son 1000 bytes UTF-8 y se aplica en el servicio,
// donde se puede contar en la unidad correcta.
export const PrivateReplySchema = z.object({
  text: z.string().trim().min(1).max(2000),
})

export const DeliverySchema = z.object({
  id: UuidSchema,
  eventId: z.string(),
  attempt: z.number().int().positive(),
  status: z.enum(["success", "failed"]),
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  attemptedAt: IsoDateSchema,
})

export const DeliveryListQuerySchema = z.object({
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
})

export type PaginationDto = z.infer<typeof PaginationSchema>
export type MeDto = z.infer<typeof MeSchema>
export type Channel = z.infer<typeof ChannelSchema>
export type PageDto = z.infer<typeof PageSchema>
export type MessageDto = z.infer<typeof MessageSchema>
export type MessageType = z.infer<typeof MessageTypeSchema>
export type MessageOrigin = z.infer<typeof MessageOriginSchema>
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>
export type MessageContent = z.infer<typeof MessageContentSchema>
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>
export type AttachmentStatus = z.infer<typeof AttachmentStatusSchema>
export type AttachmentDto = z.infer<typeof AttachmentSchema>
export type MediaUploadStatus = z.infer<typeof MediaUploadStatusSchema>
export type MediaUploadDto = z.infer<typeof MediaUploadSchema>
export type CreateMediaUploadInput = z.infer<typeof CreateMediaUploadSchema>
export type ConversationDto = z.infer<typeof ConversationSchema>
export type CommentDto = z.infer<typeof CommentSchema>
export type DeliveryDto = z.infer<typeof DeliverySchema>
export type PageListQuery = z.infer<typeof PageListQuerySchema>
export type ConversationListInput = z.infer<typeof ConversationListQuerySchema>
export type MessageListInput = z.infer<typeof MessageListQuerySchema>
export type CommentListInput = z.infer<typeof CommentListQuerySchema>
export type SendMessageInput = z.infer<typeof SendMessageSchema>
export type CommentReplyInput = z.infer<typeof CommentReplySchema>
export type PrivateReplyInput = z.infer<typeof PrivateReplySchema>

export type ConversationListDto = {
  data: ConversationDto[]
  pagination: PaginationDto
}

export type ConversationThreadDto = {
  conversation: ConversationDto
  messages: MessageDto[]
  pagination: PaginationDto
}
