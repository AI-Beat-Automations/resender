import "server-only"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import {
  AccountDeletionResultSchema,
  ApiKeyListSchema,
  ApiKeySchema,
  BackendHealthSchema,
  BillingStateSchema,
  CheckoutVerificationSchema,
  ConversationListSchema,
  ConversationThreadSchema,
  CreatedApiKeySchema,
  ProductAccessSchema,
  ProductShellSchema,
  RpcPageSchema,
  RpcPageListSchema,
  StripeRedirectSchema,
  WebhookSecretSchema,
  type BackendHealthDto,
  type AccountDeletionResultDto,
  type ApiKeyCreateRpcInput,
  type ApiKeyDto,
  type ApiKeyRevokeRpcInput,
  type BillingPortalSessionRpcInput,
  type BillingStateDto,
  type ChangePasswordRpcInput,
  type CheckoutSessionRpcInput,
  type CheckoutVerificationDto,
  type CheckoutVerificationRpcInput,
  type ConversationListDto,
  type ConversationListInput,
  type ConversationThreadDto,
  type ConversationThreadRpcInput,
  type CreatedApiKeyDto,
  type DeleteAccountRpcInput,
  type ProductAccessDto,
  type ProductShellDto,
  type RpcActor,
  type RpcPageDto,
  type PageIdRpcInput,
  type PageWebhookUpdateRpcInput,
  type StripeRedirectDto,
  type WebhookSecretDto,
  type WebAppApiContract,
} from "@workspace/contracts"

import { classifyRpcError, type RpcErrorClassification } from "./rpc-error"

const UNAVAILABLE_MESSAGE = "Backend service is unavailable."
const REQUEST_FAILED_MESSAGE = "Backend request failed."
const INVALID_RESPONSE_MESSAGE = "Backend response is invalid."
const API_KEY_VISIBLE_PREFIX = /^pk_live_[A-Za-z0-9_-]{8}$/u
const API_KEY_SECRET = /^pk_live_[A-Za-z0-9_-]{43}$/u
const STRIPE_REDIRECT_HOSTS = {
  checkout: "checkout.stripe.com",
  portal: "billing.stripe.com",
} as const
const SENSITIVE_BILLING_FIELDS = new Set([
  "customer",
  "customerId",
  "stripeCustomerId",
  "subscriptionId",
  "stripeSubscriptionId",
  "secret",
  "secretKey",
  "stripeSecretKey",
  "apiKey",
  "token",
  "accessToken",
])

export class BackendUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE)
    this.name = "BackendUnavailableError"
  }
}

export class BackendRpcError extends Error {
  readonly classification: RpcErrorClassification

  constructor(classification: RpcErrorClassification) {
    super(REQUEST_FAILED_MESSAGE)
    this.name = "BackendRpcError"
    this.classification = classification
  }
}

export class BackendProtocolError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE)
    this.name = "BackendProtocolError"
  }
}

export async function getBackend(): Promise<WebAppApiContract> {
  let context: Awaited<ReturnType<typeof getCloudflareContext>>
  try {
    context = await getCloudflareContext({ async: true })
  } catch {
    throw new BackendUnavailableError()
  }

  const binding: CloudflareEnv["BACKEND"] | undefined = context.env.BACKEND
  if (!binding) throw new BackendUnavailableError()
  const backend: WebAppApiContract = binding
  return backend
}

export async function smokeBackend(): Promise<BackendHealthDto> {
  const response = await invokeBackend((backend) => backend.health())
  const parsed = BackendHealthSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

export async function getProductAccess(
  actor: RpcActor
): Promise<ProductAccessDto> {
  const response = await invokeBackend((backend) =>
    backend.getProductAccess(actor)
  )
  const parsed = ProductAccessSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

export async function getProductShell(
  actor: RpcActor
): Promise<ProductShellDto> {
  const response = await invokeBackend((backend) =>
    backend.getProductShell(actor)
  )
  const parsed = ProductShellSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  if (parsed.data.tenantId !== actor.userId) {
    throw new BackendProtocolError()
  }
  return parsed.data
}

export async function listConversations(
  actor: RpcActor,
  input: ConversationListInput
): Promise<ConversationListDto> {
  const response = await invokeBackend((backend) =>
    backend.listConversations(actor, input)
  )
  const parsed = ConversationListSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  if (
    input.pageId &&
    parsed.data.data.some(
      (conversation) => conversation.page.id !== input.pageId
    )
  ) {
    throw new BackendProtocolError()
  }
  return parsed.data
}

export async function getConversationThread(
  actor: RpcActor,
  input: ConversationThreadRpcInput
): Promise<ConversationThreadDto> {
  const response = await invokeBackend((backend) =>
    backend.getConversationThread(actor, input)
  )
  const parsed = ConversationThreadSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()

  const { conversation, messages } = parsed.data
  if (
    conversation.id !== input.conversationId ||
    messages.some(
      (message) =>
        message.conversationId !== input.conversationId ||
        message.pageId !== conversation.page.id ||
        message.contactId !== conversation.contact.id
    )
  ) {
    throw new BackendProtocolError()
  }
  return parsed.data
}

export async function listPages(actor: RpcActor): Promise<RpcPageDto[]> {
  const response = await invokeBackend((backend) => backend.listPages(actor))
  const parsed = RpcPageListSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  const seenPageIds = new Set<string>()
  return parsed.data.map((page) => {
    if (seenPageIds.has(page.id)) throw new BackendProtocolError()
    seenPageIds.add(page.id)
    return sanitizeRpcPage(page)
  })
}

export async function updatePageWebhook(
  actor: RpcActor,
  input: PageWebhookUpdateRpcInput
): Promise<RpcPageDto> {
  const response = await invokeBackend((backend) =>
    backend.updatePageWebhook(actor, input)
  )
  const page = parseRpcPage(response)
  if (page.id !== input.pageId || page.status !== "active") {
    throw new BackendProtocolError()
  }
  return page
}

export async function disconnectPage(
  actor: RpcActor,
  input: PageIdRpcInput
): Promise<RpcPageDto> {
  const response = await invokeBackend((backend) =>
    backend.disconnectPage(actor, input)
  )
  const page = parseRpcPage(response)
  if (page.id !== input.pageId || page.status !== "disconnected") {
    throw new BackendProtocolError()
  }
  return page
}

export async function rotateWebhookSecret(
  actor: RpcActor,
  input: PageIdRpcInput
): Promise<WebhookSecretDto> {
  const response = await invokeBackend((backend) =>
    backend.rotateWebhookSecret(actor, input)
  )
  const parsed = WebhookSecretSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

export async function listApiKeys(actor: RpcActor): Promise<ApiKeyDto[]> {
  const response = await invokeBackend((backend) => backend.listApiKeys(actor))
  const parsed = ApiKeyListSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()

  const seenIds = new Set<string>()
  let previous: ApiKeyDto | null = null
  return parsed.data.map((apiKey) => {
    assertSafeApiKeyMetadata(apiKey)
    if (seenIds.has(apiKey.id)) throw new BackendProtocolError()
    if (previous && compareApiKeyOrder(previous, apiKey) > 0) {
      throw new BackendProtocolError()
    }
    seenIds.add(apiKey.id)
    previous = apiKey
    return apiKey
  })
}

export async function createApiKey(
  actor: RpcActor,
  input: ApiKeyCreateRpcInput
): Promise<CreatedApiKeyDto> {
  const response = await invokeBackend((backend) =>
    backend.createApiKey(actor, input)
  )
  const parsed = CreatedApiKeySchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  const created = parsed.data
  assertSafeApiKeyMetadata(created.record)
  if (
    created.record.status !== "active" ||
    created.record.lastUsedAt !== null ||
    created.record.revokedAt !== null ||
    !API_KEY_SECRET.test(created.apiKey) ||
    !created.apiKey.startsWith(created.record.visiblePrefix)
  ) {
    throw new BackendProtocolError()
  }
  return created
}

export async function revokeApiKey(
  actor: RpcActor,
  input: ApiKeyRevokeRpcInput
): Promise<ApiKeyDto> {
  const response = await invokeBackend((backend) =>
    backend.revokeApiKey(actor, input)
  )
  const parsed = ApiKeySchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  const revoked = parsed.data
  assertSafeApiKeyMetadata(revoked)
  if (
    revoked.id !== input.apiKeyId ||
    revoked.status !== "revoked" ||
    revoked.revokedAt === null
  ) {
    throw new BackendProtocolError()
  }
  return revoked
}

export async function getBillingState(
  actor: RpcActor
): Promise<BillingStateDto> {
  const response = await invokeBackend((backend) =>
    backend.getBillingState(actor)
  )
  assertNoSensitiveBillingFields(response)
  const parsed = BillingStateSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

export async function createCheckoutSession(
  actor: RpcActor,
  input: CheckoutSessionRpcInput
): Promise<StripeRedirectDto> {
  const response = await invokeBackend((backend) =>
    backend.createCheckoutSession(actor, input)
  )
  return parseStripeRedirect(response, ["checkout", "portal"])
}

export async function createBillingPortalSession(
  actor: RpcActor,
  input: BillingPortalSessionRpcInput
): Promise<StripeRedirectDto> {
  const response = await invokeBackend((backend) =>
    backend.createBillingPortalSession(actor, input)
  )
  return parseStripeRedirect(response, ["portal"])
}

export async function verifyCheckoutSession(
  actor: RpcActor,
  input: CheckoutVerificationRpcInput
): Promise<CheckoutVerificationDto> {
  const response = await invokeBackend((backend) =>
    backend.verifyCheckoutSession(actor, input)
  )
  assertNoSensitiveBillingFields(response)
  const parsed = CheckoutVerificationSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

export async function changePassword(
  actor: RpcActor,
  input: ChangePasswordRpcInput
): Promise<void> {
  const response = await invokeBackend((backend) =>
    backend.changePassword(actor, input)
  )
  if (response !== undefined) throw new BackendProtocolError()
}

export async function deleteAccount(
  actor: RpcActor,
  input: DeleteAccountRpcInput
): Promise<AccountDeletionResultDto> {
  const response = await invokeBackend((backend) =>
    backend.deleteAccount(actor, input)
  )
  const parsed = AccountDeletionResultSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

async function invokeBackend<T>(
  operation: (backend: WebAppApiContract) => Promise<T>
): Promise<T> {
  const backend = await getBackend()
  try {
    return await operation(backend)
  } catch (error) {
    throw new BackendRpcError(classifyRpcError(error))
  }
}

function parseRpcPage(response: unknown): RpcPageDto {
  const parsed = RpcPageSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return sanitizeRpcPage(parsed.data)
}

function sanitizeRpcPage(page: RpcPageDto): RpcPageDto {
  return {
    ...page,
    tokenError:
      page.tokenStatus === "invalid"
        ? "The Page credential is invalid. Reconnect the Page."
        : null,
  }
}

function assertSafeApiKeyMetadata(apiKey: ApiKeyDto) {
  if (!API_KEY_VISIBLE_PREFIX.test(apiKey.visiblePrefix)) {
    throw new BackendProtocolError()
  }
  if (
    (apiKey.status === "active" && apiKey.revokedAt !== null) ||
    (apiKey.status === "revoked" && apiKey.revokedAt === null)
  ) {
    throw new BackendProtocolError()
  }
}

function compareApiKeyOrder(left: ApiKeyDto, right: ApiKeyDto) {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt)
  return byCreatedAt || right.id.localeCompare(left.id)
}

function parseStripeRedirect(
  response: unknown,
  surfaces: Array<keyof typeof STRIPE_REDIRECT_HOSTS>
): StripeRedirectDto {
  assertNoSensitiveBillingFields(response)
  const parsed = StripeRedirectSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  let url: URL
  try {
    url = new URL(parsed.data.url)
  } catch {
    throw new BackendProtocolError()
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !surfaces.some((surface) => url.hostname === STRIPE_REDIRECT_HOSTS[surface])
  ) {
    throw new BackendProtocolError()
  }
  return { url: url.toString() }
}

function assertNoSensitiveBillingFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveBillingFields(item)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (
      SENSITIVE_BILLING_FIELDS.has(key) ||
      normalizedKey.endsWith("customerid") ||
      normalizedKey.endsWith("subscriptionid") ||
      normalizedKey.includes("stripesecret")
    ) {
      throw new BackendProtocolError()
    }
    assertNoSensitiveBillingFields(child)
  }
}
