import { z } from "zod"

import {
  ConversationSchema,
  MessageSchema,
  PageSchema,
  PlanLookupKeySchema,
} from "./api"
import { CursorSchema, IsoDateSchema, LimitSchema, UuidSchema } from "./common"

export const RpcActorSchema = z.object({ userId: UuidSchema })

export const BackendHealthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("api"),
    entrypoint: z.literal("rpc"),
  })
  .strict()

const EmailInputSchema = z.string().trim().max(320).pipe(z.email())
const PasswordInputSchema = z.string().min(1).max(1024)
const WebUrlInputSchema = z.string().max(2048).pipe(z.url())
const ProviderPageIdInputSchema = z.string().trim().min(1).max(255)

export const AuthenticateCredentialsRpcInputSchema = z.object({
  email: EmailInputSchema,
  password: PasswordInputSchema,
})

export const RegisterUserRpcInputSchema = AuthenticateCredentialsRpcInputSchema

export const ApiKeyCreateRpcInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
})

export const ApiKeyRevokeRpcInputSchema = z.object({
  apiKeyId: UuidSchema,
})

export const ChangePasswordRpcInputSchema = z.object({
  newPassword: z.string().min(8).max(1024),
})

export const DeleteAccountRpcInputSchema = z.object({
  confirmEmail: EmailInputSchema.transform((email) => email.toLowerCase()),
})

export const CheckoutSessionRpcInputSchema = z.object({
  priceLookupKey: z.string().trim().min(1).max(100),
  returnUrl: WebUrlInputSchema,
})

export const BillingPortalSessionRpcInputSchema = z.object({
  returnUrl: WebUrlInputSchema,
})

export const CheckoutVerificationRpcInputSchema = z.object({
  sessionId: z
    .string()
    .trim()
    .regex(/^cs_(?:test|live)_[A-Za-z0-9]{16,200}$/u),
})

export const MetaAuthorizationRpcInputSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  redirectUri: WebUrlInputSchema,
})

export const ConnectMetaPagesRpcInputSchema = z.object({
  providerPageIds: z
    .array(ProviderPageIdInputSchema)
    .min(1, "Select at least one Page.")
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Page selection cannot contain duplicates.",
    }),
})

export const PageIdRpcInputSchema = z.object({
  pageId: UuidSchema,
})

export const PageWebhookUpdateRpcInputSchema = PageIdRpcInputSchema.extend({
  webhookUrl: WebUrlInputSchema.nullable(),
})

export const AuthenticatedUserSchema = z.object({
  id: UuidSchema,
  email: z.email(),
  waitlisted: z.boolean(),
  createdAt: IsoDateSchema,
})

export const ProductAccessSchema = z
  .object({
    userExists: z.boolean(),
    waitlisted: z.boolean(),
    subscriptionActive: z.boolean(),
    destination: z.enum(["waitlist", "billing", "product"]),
  })
  .superRefine((access, context) => {
    const destination =
      !access.userExists || access.waitlisted
        ? "waitlist"
        : access.subscriptionActive
          ? "product"
          : "billing"
    const missingUserHasSafeFlags =
      access.userExists || (!access.waitlisted && !access.subscriptionActive)
    const waitlistWasShortCircuited =
      !access.waitlisted || !access.subscriptionActive

    if (
      access.destination !== destination ||
      !missingUserHasSafeFlags ||
      !waitlistWasShortCircuited
    ) {
      context.addIssue({
        code: "custom",
        message: "Product access fields are inconsistent.",
      })
    }
  })

export const ProductShellSchema = z.object({
  tenantId: UuidSchema,
  email: z.email(),
  entitlement: z
    .object({
      priceLookupKey: PlanLookupKeySchema.nullable(),
      usage: z.number().int().nonnegative(),
      messageLimit: z.number().int().positive().nullable(),
      activePageCount: z.number().int().nonnegative(),
      pageLimit: z.number().int().positive().nullable(),
      blockCode: z
        .enum(["quota_exceeded", "page_limit_exceeded", "plan_unavailable"])
        .nullable(),
      // Optional for the API-first rolling deployment. Older API versions do
      // not emit it; web may only infer "blocked" from an existing blockCode.
      noticeLevel: z.enum(["warning", "blocked"]).nullable().optional(),
    })
    .superRefine((entitlement, context) => {
      if (
        (entitlement.blockCode &&
          entitlement.noticeLevel &&
          entitlement.noticeLevel !== "blocked") ||
        (!entitlement.blockCode && entitlement.noticeLevel === "blocked")
      ) {
        context.addIssue({
          code: "custom",
          message: "Entitlement notice fields are inconsistent.",
        })
      }
    }),
})

export const AuthorizedMetaPageSchema = z.object({
  providerPageId: z.string(),
  name: z.string(),
  state: z.enum(["selectable", "already_connected", "owned_by_other_tenant"]),
})

export const RpcPageSchema = PageSchema.extend({
  tokenError: z.string().nullable(),
  tokenErrorAt: IsoDateSchema.nullable(),
  disconnectedAt: IsoDateSchema.nullable(),
})

export const RpcPageListSchema = z.array(RpcPageSchema)

export const ConversationThreadRpcInputSchema = z.object({
  conversationId: UuidSchema,
  limit: LimitSchema.removeDefault().optional(),
  cursor: CursorSchema.optional(),
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

export const ApiKeyListSchema = z.array(ApiKeySchema)

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
export type BackendHealthDto = z.infer<typeof BackendHealthSchema>
export type AuthenticateCredentialsRpcInput = z.infer<
  typeof AuthenticateCredentialsRpcInputSchema
>
export type RegisterUserRpcInput = z.infer<typeof RegisterUserRpcInputSchema>
export type ApiKeyCreateRpcInput = z.infer<typeof ApiKeyCreateRpcInputSchema>
export type ApiKeyRevokeRpcInput = z.infer<typeof ApiKeyRevokeRpcInputSchema>
export type ChangePasswordRpcInput = z.infer<
  typeof ChangePasswordRpcInputSchema
>
export type DeleteAccountRpcInput = z.infer<typeof DeleteAccountRpcInputSchema>
export type CheckoutSessionRpcInput = z.infer<
  typeof CheckoutSessionRpcInputSchema
>
export type BillingPortalSessionRpcInput = z.infer<
  typeof BillingPortalSessionRpcInputSchema
>
export type CheckoutVerificationRpcInput = z.infer<
  typeof CheckoutVerificationRpcInputSchema
>
export type MetaAuthorizationRpcInput = z.infer<
  typeof MetaAuthorizationRpcInputSchema
>
export type PageIdRpcInput = z.infer<typeof PageIdRpcInputSchema>
export type PageWebhookUpdateRpcInput = z.infer<
  typeof PageWebhookUpdateRpcInputSchema
>
export type AuthenticatedUserDto = z.infer<typeof AuthenticatedUserSchema>
export type ProductAccessDto = z.infer<typeof ProductAccessSchema>
export type ProductShellDto = z.infer<typeof ProductShellSchema>
export type AuthorizedMetaPageDto = z.infer<typeof AuthorizedMetaPageSchema>
export type MetaPageSelectionDto = z.infer<typeof MetaPageSelectionSchema>
export type ConversationThreadRpcInput = z.infer<
  typeof ConversationThreadRpcInputSchema
>
export type ApiKeyDto = z.infer<typeof ApiKeySchema>
export type ApiKeyListDto = z.infer<typeof ApiKeyListSchema>
export type CreatedApiKeyDto = z.infer<typeof CreatedApiKeySchema>
export type BillingStateDto = z.infer<typeof BillingStateSchema>
export type AccountDeletionResultDto = z.infer<
  typeof AccountDeletionResultSchema
>

export type ConnectMetaPagesInput = z.infer<
  typeof ConnectMetaPagesRpcInputSchema
>

export type MetaAuthorizationResultDto = {
  authorized: true
}

export type CheckoutVerificationDto = {
  complete: boolean
}

export type RpcConversationDto = z.infer<typeof ConversationSchema>
export type RpcMessageDto = z.infer<typeof MessageSchema>
export type RpcPageDto = z.infer<typeof RpcPageSchema>
