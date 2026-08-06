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
export const ChannelSchema = z.enum(["messenger", "instagram"])

export const PageSchema = z.object({
  id: UuidSchema,
  provider: z.literal("meta"),
  channel: ChannelSchema,
  providerPageId: z.string(),
  name: z.string(),
  // El @handle. Solo Instagram lo tiene; en Messenger va null. Siempre presente
  // para que el consumidor no tenga que ramificar por canal para leerlo.
  username: z.string().nullable(),
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

export const MessageSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  pageId: UuidSchema,
  contactId: z.string(),
  direction: MessageDirectionSchema,
  status: MessageStatusSchema,
  type: z.literal("text"),
  text: z.string(),
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

// El techo de 2000 es el de Messenger. Instagram corta antes y en otra unidad
// —1000 **bytes** UTF-8—, pero el esquema no sabe a qué canal apunta el
// `pageId`, así que ese límite se aplica en el servicio una vez resuelta la
// cuenta. Acá queda el máximo absoluto que ningún canal supera.
export const SendMessageSchema = z.object({
  pageId: UuidSchema,
  recipientId: z.string().trim().min(1).max(255),
  conversationId: UuidSchema.optional(),
  type: z.literal("text"),
  text: z.string().trim().min(1).max(2000),
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
