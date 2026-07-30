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

export const PageSchema = z.object({
  id: UuidSchema,
  provider: z.literal("meta"),
  providerPageId: z.string(),
  name: z.string(),
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

export const ConversationListSchema = z.object({
  data: z.array(ConversationSchema),
  pagination: PaginationSchema,
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

export const ConversationThreadSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(MessageSchema),
  pagination: PaginationSchema,
  order: z.literal("newest_first"),
})

export const SendMessageSchema = z.object({
  pageId: UuidSchema,
  recipientId: z.string().trim().min(1).max(255),
  conversationId: UuidSchema.optional(),
  type: z.literal("text"),
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
export type PageDto = z.infer<typeof PageSchema>
export type WebhookSecretDto = z.infer<typeof WebhookSecretSchema>
export type MessageDto = z.infer<typeof MessageSchema>
export type ConversationDto = z.infer<typeof ConversationSchema>
export type DeliveryDto = z.infer<typeof DeliverySchema>
export type PageListQuery = z.infer<typeof PageListQuerySchema>
export type ConversationListInput = z.infer<typeof ConversationListQuerySchema>
export type MessageListInput = z.infer<typeof MessageListQuerySchema>
export type SendMessageInput = z.infer<typeof SendMessageSchema>

export type ConversationListDto = z.infer<typeof ConversationListSchema>
export type ConversationThreadDto = z.infer<typeof ConversationThreadSchema>
