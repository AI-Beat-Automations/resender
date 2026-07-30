import { z } from "zod"

import {
  ConversationSchema,
  MessageSchema,
  PageSchema,
  PlanLookupKeySchema,
} from "./api"
import { IsoDateSchema, UuidSchema } from "./common"

export const RpcActorSchema = z.object({ userId: UuidSchema })

export const AuthenticatedUserSchema = z.object({
  id: UuidSchema,
  email: z.email(),
  waitlisted: z.boolean(),
  createdAt: IsoDateSchema,
})

export const ProductAccessSchema = z.object({
  userExists: z.boolean(),
  waitlisted: z.boolean(),
  subscriptionActive: z.boolean(),
  destination: z.enum(["waitlist", "billing", "product"]),
})

export const ProductShellSchema = z.object({
  tenantId: UuidSchema,
  email: z.email(),
  entitlement: z.object({
    priceLookupKey: PlanLookupKeySchema.nullable(),
    usage: z.number().int().nonnegative(),
    messageLimit: z.number().int().positive().nullable(),
    activePageCount: z.number().int().nonnegative(),
    pageLimit: z.number().int().positive().nullable(),
    blockCode: z
      .enum(["quota_exceeded", "page_limit_exceeded", "plan_unavailable"])
      .nullable(),
  }),
})

export const AuthorizedMetaPageSchema = z.object({
  providerPageId: z.string(),
  name: z.string(),
  state: z.enum(["selectable", "already_connected", "owned_by_other_tenant"]),
})

export const MetaPageSelectionSchema = z.object({
  pages: z.array(AuthorizedMetaPageSchema),
  maxPages: z.number().int().nonnegative(),
  activePageCount: z.number().int().nonnegative(),
  remainingSlots: z.number().int().nonnegative(),
})

export const ApiKeySchema = z.object({
  id: UuidSchema,
  label: z.string(),
  visiblePrefix: z.string(),
  status: z.enum(["active", "revoked"]),
  createdAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema.nullable(),
  revokedAt: IsoDateSchema.nullable(),
})

export const CreatedApiKeySchema = z.object({
  apiKey: z.string().startsWith("pk_live_"),
  record: ApiKeySchema,
})

export const BillingStateSchema = z.object({
  subscription: z
    .object({
      status: z.string(),
      priceLookupKey: z.string(),
      currentPeriodStart: IsoDateSchema.nullable(),
      currentPeriodEnd: IsoDateSchema.nullable(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullable(),
  entitlement: ProductShellSchema.shape.entitlement,
})

export const AccountDeletionResultSchema = z.object({
  deleted: z.boolean(),
  metaUnsubscribeFailures: z.number().int().nonnegative(),
  stripeCancellationFailed: z.boolean(),
})

export type RpcActor = z.infer<typeof RpcActorSchema>
export type AuthenticatedUserDto = z.infer<typeof AuthenticatedUserSchema>
export type ProductAccessDto = z.infer<typeof ProductAccessSchema>
export type ProductShellDto = z.infer<typeof ProductShellSchema>
export type AuthorizedMetaPageDto = z.infer<typeof AuthorizedMetaPageSchema>
export type MetaPageSelectionDto = z.infer<typeof MetaPageSelectionSchema>
export type ApiKeyDto = z.infer<typeof ApiKeySchema>
export type CreatedApiKeyDto = z.infer<typeof CreatedApiKeySchema>
export type BillingStateDto = z.infer<typeof BillingStateSchema>
export type AccountDeletionResultDto = z.infer<
  typeof AccountDeletionResultSchema
>

export type ConnectMetaPagesInput = {
  providerPageIds: string[]
}

export type MetaAuthorizationResultDto = {
  authorized: true
}

export type CheckoutVerificationDto = {
  complete: boolean
}

export type RpcConversationDto = z.infer<typeof ConversationSchema>
export type RpcMessageDto = z.infer<typeof MessageSchema>
export type RpcPageDto = z.infer<typeof PageSchema>
