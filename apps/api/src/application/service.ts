import type {
  AccountDeletionResultDto,
  ApiKeyDto,
  BillingStateDto,
  CheckoutVerificationDto,
  ConnectMetaPagesInput,
  ConversationListDto,
  ConversationListInput,
  ConversationThreadDto,
  ConversationThreadRpcInput,
  CreatedApiKeyDto,
  DeliveryDto,
  MeDto,
  MessageDto,
  MessageListInput,
  MetaAuthorizationResultDto,
  MetaPageSelectionDto,
  PageDto,
  PageListQuery,
  ProductAccessDto,
  ProductShellDto,
  RpcActor,
  RpcPageDto,
  SendMessageInput,
} from "@workspace/contracts"
import { ContractError } from "@workspace/contracts"
import type Stripe from "stripe"

import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  RECOVERY_HANDOFF_GRACE_SECONDS,
  WEBHOOK_PAYLOAD_VERSION,
} from "../config"
import {
  entitlementHttpError,
  entitlementNoticeLevel,
  evaluateEntitlement,
  isCanonicalPlanLookupKey,
  PLAN_LIMITS,
  type Entitlement,
} from "../domain/entitlements"
import { extractInboundMetaEvents } from "../domain/meta-events"
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateIntegrationIdentifier,
  generateWebhookSigningSecret,
  hashApiKey,
  hashPassword,
  hmacHex,
  isApiKeyFormat,
  safeEqualText,
  sha256Hex,
  verifyPassword,
} from "../infrastructure/crypto/secrets"
import { createSql } from "../infrastructure/db/client"
import {
  messageDto,
  pageDto,
  rpcPageDto,
  SqlRepository,
  type MessageRecord,
  type PageRecord,
  type SubscriptionRecord,
  type UserRecord,
} from "../infrastructure/db/repository"
import {
  assertPublicWebhookDestination,
  validateWebhookUrl,
} from "../infrastructure/http/ssrf"
import { MetaClient } from "../infrastructure/meta/client"
import {
  createStripeClient,
  stripeTimestamp,
} from "../infrastructure/stripe/client"
import { log } from "../observability/logger"

export type QueuePayload = {
  jobId: string
  messageId: string
}

export type AuthenticatedApiKey = {
  tenantId: string
  apiKeyId: string
}

const DUMMY_PASSWORD_HASH =
  "scrypt$cmVzZW5kZXItcnBjLWR1bW15$mpc4UMVvwELJGvPk2eEeNmpyNsoB1Nq3YK33obvkzaU09t0MoXXu8Qncm03RrkGXDwXQVyVEniZ4OlwR8ONXtg"

export class ApiService {
  readonly meta: MetaClient
  private repositoryClient: SqlRepository | null = null
  private stripeClient: Stripe | null = null
  private readonly now: () => Date
  private readonly passwordVerifier: typeof verifyPassword

  constructor(
    readonly env: Env,
    dependencies: {
      repository?: SqlRepository
      meta?: MetaClient
      stripe?: Stripe
      now?: () => Date
      verifyPassword?: typeof verifyPassword
    } = {}
  ) {
    this.repositoryClient = dependencies.repository ?? null
    this.meta =
      dependencies.meta ?? new MetaClient(env.META_APP_ID, env.META_APP_SECRET)
    this.stripeClient = dependencies.stripe ?? null
    this.now = dependencies.now ?? (() => new Date())
    this.passwordVerifier = dependencies.verifyPassword ?? verifyPassword
  }

  get repository(): SqlRepository {
    this.repositoryClient ??= new SqlRepository(
      createSql(this.env.DATABASE_URL)
    )
    return this.repositoryClient
  }

  get stripe(): Stripe {
    this.stripeClient ??= createStripeClient(this.env.STRIPE_SECRET_KEY)
    return this.stripeClient
  }

  async ready(): Promise<boolean> {
    requiredConfiguration(this.env)
    const [databaseReady, unsignedWebhookPages] = await Promise.all([
      this.repository.ping(),
      this.repository.countUnsignedWebhookPages(),
    ])
    return databaseReady && unsignedWebhookPages === 0
  }

  async authenticateApiKey(value: string | null): Promise<AuthenticatedApiKey> {
    if (!value) {
      throw new ContractError({
        code: "missing_api_key",
        message: "Authorization must contain a bearer API key.",
        status: 401,
      })
    }
    const [scheme, apiKey, extra] = value.trim().split(/\s+/u)
    if (
      scheme?.toLowerCase() !== "bearer" ||
      !apiKey ||
      extra ||
      !isApiKeyFormat(apiKey)
    ) {
      throw invalidApiKey()
    }
    const secretHash = await hashApiKey(apiKeyPepper(this.env), apiKey)
    const record = await this.repository.getApiKeyByHash(secretHash)
    if (!record || record.status !== "active") throw invalidApiKey()
    if (!(await this.repository.touchApiKey(record.id))) throw invalidApiKey()
    return { tenantId: record.tenantId, apiKeyId: record.id }
  }

  async requireProductAccess(
    tenantId: string
  ): Promise<{ user: UserRecord; subscription: SubscriptionRecord }> {
    const user = await this.repository.getUserById(tenantId)
    if (!user) throw notFound("Account")
    if (user.waitlisted) {
      throw new ContractError({
        code: "account_waitlisted",
        message: "This account is still on the waitlist.",
        status: 403,
      })
    }
    const subscription = await this.requireActiveSubscription(tenantId)
    return { user, subscription }
  }

  async getMe(tenantId: string): Promise<MeDto> {
    const { subscription } = await this.requireProductAccess(tenantId)
    if (!isCanonicalPlanLookupKey(subscription.priceLookupKey)) {
      throw planError("plan_unavailable")
    }
    return {
      tenantId,
      plan: {
        status: subscription.status,
        lookupKey: subscription.priceLookupKey,
      },
    }
  }

  listPages(
    tenantId: string,
    input: PageListQuery
  ): Promise<{
    data: PageDto[]
    pagination: { hasMore: boolean; nextCursor: string | null }
  }> {
    return this.repository.listPages(tenantId, input)
  }

  async getPage(tenantId: string, pageId: string): Promise<PageDto> {
    return pageDto(await this.requirePage(tenantId, pageId))
  }

  async updatePageWebhook(
    tenantId: string,
    pageId: string,
    webhookUrl: string | null
  ): Promise<PageDto> {
    return pageDto(
      await this.updatePageWebhookRecord(tenantId, pageId, webhookUrl)
    )
  }

  async updatePageWebhookForRpc(
    tenantId: string,
    pageId: string,
    webhookUrl: string | null
  ): Promise<RpcPageDto> {
    return rpcPageDto(
      await this.updatePageWebhookRecord(tenantId, pageId, webhookUrl)
    )
  }

  private async updatePageWebhookRecord(
    tenantId: string,
    pageId: string,
    webhookUrl: string | null
  ): Promise<PageRecord> {
    const pageBeforeUpdate = await this.requireActivePage(tenantId, pageId)
    const normalized = validateWebhookUrl(webhookUrl)
    if (normalized) await assertPublicWebhookDestination(normalized)
    if (normalized && !pageBeforeUpdate.webhookSigningSecretEncrypted) {
      throw new ContractError({
        code: "validation_error",
        message:
          "Rotate this Page's webhook signing secret before enabling its webhook URL.",
        status: 400,
        details: [
          {
            path: "webhookUrl",
            message: "Rotate the webhook signing secret first.",
          },
        ],
      })
    }
    const page = await this.repository.updatePageWebhook(
      tenantId,
      pageId,
      normalized
    )
    if (!page) throw notFound("Page")
    return page
  }

  async rotateWebhookSecret(
    tenantId: string,
    pageId: string
  ): Promise<{ secret: string; createdAt: string }> {
    await this.requireActivePage(tenantId, pageId)
    const secret = generateWebhookSigningSecret()
    const createdAt = await this.repository.rotateWebhookSecret({
      tenantId,
      pageId,
      encryptedSecret: encryptSecret(this.env.TOKEN_ENCRYPTION_KEY, secret),
    })
    if (!createdAt) throw notFound("Page")
    return { secret, createdAt: createdAt.toISOString() }
  }

  listConversations(
    tenantId: string,
    input: ConversationListInput
  ): Promise<ConversationListDto> {
    return this.repository.listConversations(tenantId, input)
  }

  async getConversation(tenantId: string, conversationId: string) {
    const result = await this.repository.getConversation(
      tenantId,
      conversationId
    )
    if (!result) throw notFound("Conversation")
    return result
  }

  async getConversationThread(
    tenantId: string,
    conversationId: string,
    input: Omit<ConversationThreadRpcInput, "conversationId"> & {
      limit: number
    }
  ): Promise<ConversationThreadDto> {
    const conversation = await this.getConversation(tenantId, conversationId)
    const messages = await this.repository.listConversationMessages(
      tenantId,
      conversationId,
      input
    )
    return {
      conversation,
      messages: messages.data,
      pagination: messages.pagination,
      order: "newest_first",
    }
  }

  listMessages(
    tenantId: string,
    input: MessageListInput
  ): Promise<{
    data: MessageDto[]
    pagination: { hasMore: boolean; nextCursor: string | null }
  }> {
    return this.repository.listMessages(tenantId, input)
  }

  async getMessage(tenantId: string, messageId: string): Promise<MessageDto> {
    const message = await this.repository.getMessage(tenantId, messageId)
    if (!message) throw notFound("Message")
    return messageDto(message)
  }

  async listDeliveries(
    tenantId: string,
    messageId: string,
    input: { limit: number; cursor?: string }
  ): Promise<{
    data: DeliveryDto[]
    pagination: { hasMore: boolean; nextCursor: string | null }
  }> {
    await this.getMessage(tenantId, messageId)
    return this.repository.listDeliveries(tenantId, messageId, input)
  }

  async sendMessage(input: {
    tenantId: string
    idempotencyKey: string | null
    message: SendMessageInput
  }): Promise<{ message: MessageDto; replayed: boolean; created: boolean }> {
    const key = input.idempotencyKey?.trim()
    if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new ContractError({
        code: "validation_error",
        message:
          "Idempotency-Key is required and must be at most 200 characters.",
        status: 400,
        details: [{ path: "Idempotency-Key", message: "Invalid header value" }],
      })
    }
    const page = await this.requirePage(input.tenantId, input.message.pageId)
    const conversation = input.message.conversationId
      ? await this.repository.getConversationRecord(
          input.tenantId,
          input.message.conversationId
        )
      : await this.repository.upsertConversation({
          tenantId: input.tenantId,
          pageId: page.id,
          contactId: input.message.recipientId,
          at: new Date(),
        })
    if (
      !conversation ||
      conversation.pageId !== page.id ||
      conversation.contactId !== input.message.recipientId
    ) {
      throw notFound("Conversation")
    }

    const fingerprint = await sha256Hex(
      JSON.stringify({
        conversationId: conversation.id,
        pageId: page.id,
        recipientId: input.message.recipientId,
        text: input.message.text,
        type: "text",
      })
    )
    const existing = await this.repository.getOutboundByIdempotency(
      input.tenantId,
      key
    )
    if (existing) {
      if (!existing.idempotencyFingerprint) {
        throw idempotencyConflict("legacy")
      }
      if (existing.idempotencyFingerprint !== fingerprint) {
        throw idempotencyConflict("fingerprint")
      }
      return {
        message: messageDto(existing),
        replayed: true,
        created: false,
      }
    }
    const entitlement = await this.entitlement(input.tenantId)
    this.assertCanMessage(entitlement)
    if (page.status !== "active") throw notFound("Page")
    if (page.tokenStatus !== "valid") {
      throw new ContractError({
        code: "provider_rejected",
        message: "The Page access token is invalid. Reconnect the Page.",
        status: 422,
      })
    }
    const reservation = await this.repository.reserveOutbound({
      tenantId: input.tenantId,
      idempotencyKey: key,
      fingerprint,
    })
    if (reservation.kind === "replay") {
      return {
        message: messageDto(reservation.message),
        replayed: true,
        created: false,
      }
    }
    if (reservation.kind === "conflict") {
      throw idempotencyConflict(reservation.reason)
    }

    const result = await this.meta.sendText({
      pageAccessToken: decryptSecret(
        this.env.TOKEN_ENCRYPTION_KEY,
        page.pageAccessTokenEncrypted
      ),
      recipientId: input.message.recipientId,
      text: input.message.text,
    })
    const persisted = await this.repository.completeOutbound({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      pageId: page.id,
      contactId: input.message.recipientId,
      text: input.message.text,
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.ok ? result.messageId : null,
      idempotencyKey: key,
      fingerprint,
      error: result.ok ? null : result.message,
      providerResponse: result.response,
      createdAt: new Date(),
      periodStart: result.ok ? entitlement.periodStart : null,
    })
    if (result.ok) {
      return { message: messageDto(persisted), replayed: false, created: true }
    }
    if (result.kind === "invalid_token") {
      await this.repository.markPageTokenInvalid({
        tenantId: input.tenantId,
        pageId: page.id,
        error: result.message,
      })
    }
    throw new ContractError({
      code:
        result.kind === "unavailable"
          ? "provider_unavailable"
          : "provider_rejected",
      message: result.message,
      status: result.kind === "unavailable" ? 502 : 422,
      details: [
        {
          message: "The failed attempt was persisted.",
          messageId: persisted.id,
        },
      ],
    })
  }

  async authenticateCredentials(input: {
    email: string
    password: string
  }): Promise<ReturnType<typeof userDto> | null> {
    const email = normalizedEmail(input.email)
    if (!email) return null
    const user = await this.repository.getUserByEmail(email)
    const passwordMatches = await this.passwordVerifier(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH
    )
    if (!user || !passwordMatches) {
      return null
    }
    return userDto(user)
  }

  async registerUser(input: {
    email: string
    password: string
  }): Promise<ReturnType<typeof userDto>> {
    const passwordHash = await hashPassword(input.password)
    try {
      return userDto(
        await this.repository.createUser({
          email: normalizeEmail(input.email),
          passwordHash,
        })
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContractError({
          code: "validation_error",
          message: "An account already exists for this email.",
          status: 409,
        })
      }
      throw error
    }
  }

  async getProductAccess(actor: RpcActor): Promise<ProductAccessDto> {
    const user = await this.repository.getUserById(actor.userId)
    if (!user) {
      return {
        userExists: false,
        waitlisted: false,
        subscriptionActive: false,
        destination: "waitlist",
      }
    }
    if (user.waitlisted) {
      return {
        userExists: true,
        waitlisted: true,
        subscriptionActive: false,
        destination: "waitlist",
      }
    }
    const subscription = await this.repository.getSubscription(user.id)
    const subscriptionActive = isActiveSubscription(subscription)
    return {
      userExists: true,
      waitlisted: false,
      subscriptionActive,
      destination: subscriptionActive ? "product" : "billing",
    }
  }

  async getProductShell(actor: RpcActor): Promise<ProductShellDto> {
    const { user } = await this.requireProductAccess(actor.userId)
    return {
      tenantId: user.id,
      email: user.email,
      entitlement: entitlementDto(await this.entitlement(user.id)),
    }
  }

  async listAuthorizedMetaPages(
    actor: RpcActor
  ): Promise<MetaPageSelectionDto> {
    const { user } = await this.requireProductAccess(actor.userId)
    const encrypted = await this.repository.getMetaUserTokenEncrypted(user.id)
    if (!encrypted) {
      throw new ContractError({
        code: "provider_rejected",
        message: "Authorize Meta before selecting Pages.",
        status: 422,
      })
    }
    const pages = await this.providerOperation("Meta", () =>
      this.meta.listPages(
        decryptSecret(this.env.TOKEN_ENCRYPTION_KEY, encrypted)
      )
    )
    const ownership = await this.repository.getPageOwnership(
      pages.map((page) => page.id)
    )
    const byPage = new Map(ownership.map((item) => [item.providerPageId, item]))
    const entitlement = await this.entitlement(user.id)
    const maxPages = entitlement.limits?.maxPages ?? 0
    return {
      pages: pages.map((page) => {
        const owner = byPage.get(page.id)
        return {
          providerPageId: page.id,
          name: page.name,
          state:
            owner?.tenantId === user.id && owner.status === "active"
              ? "already_connected"
              : owner?.status === "active"
                ? "owned_by_other_tenant"
                : "selectable",
        }
      }),
      maxPages,
      activePageCount: entitlement.activePageCount,
      remainingSlots: Math.max(0, maxPages - entitlement.activePageCount),
    }
  }

  async exchangeMetaAuthorizationCode(
    actor: RpcActor,
    input: { code: string; redirectUri: string }
  ): Promise<MetaAuthorizationResultDto> {
    const { user } = await this.requireProductAccess(actor.userId)
    const redirectUri = validateMetaRedirectUri(this.env, input.redirectUri)
    const token = await this.providerOperation("Meta", () =>
      this.meta.exchangeAuthorizationCode({ ...input, redirectUri })
    )
    await this.repository.saveMetaUserToken(
      user.id,
      encryptSecret(this.env.TOKEN_ENCRYPTION_KEY, token)
    )
    return { authorized: true }
  }

  async connectMetaPages(
    actor: RpcActor,
    input: ConnectMetaPagesInput
  ): Promise<RpcPageDto[]> {
    const { user } = await this.requireProductAccess(actor.userId)
    const ids = [...new Set(input.providerPageIds)]
    if (ids.length === 0) {
      throw new ContractError({
        code: "validation_error",
        message: "Select at least one Page.",
        status: 400,
        details: [
          {
            path: "providerPageIds",
            message: "Select at least one Page.",
          },
        ],
      })
    }
    const entitlement = await this.entitlement(user.id)
    if (!entitlement.limits) throw planError("plan_unavailable")
    const ownership = await this.repository.getPageOwnership(ids)
    if (
      ownership.some(
        (item) => item.status === "active" && item.tenantId !== user.id
      )
    ) {
      throw new ContractError({
        code: "provider_rejected",
        message: "One or more selected Pages belong to another account.",
        status: 422,
      })
    }
    const alreadyActive = new Set(
      ownership
        .filter((item) => item.status === "active" && item.tenantId === user.id)
        .map((item) => item.providerPageId)
    )
    if (
      entitlement.activePageCount +
        ids.filter((id) => !alreadyActive.has(id)).length >
      entitlement.limits.maxPages
    ) {
      throw planError("page_limit_exceeded")
    }
    const encrypted = await this.repository.getMetaUserTokenEncrypted(user.id)
    if (!encrypted) throw providerAuthorizationRequired()
    const authorized = await this.providerOperation("Meta", () =>
      this.meta.listPages(
        decryptSecret(this.env.TOKEN_ENCRYPTION_KEY, encrypted)
      )
    )
    const selected = authorized.filter((page) => ids.includes(page.id))
    if (selected.length !== ids.length) {
      throw new ContractError({
        code: "provider_rejected",
        message: "One or more selected Pages are no longer authorized.",
        status: 422,
      })
    }
    const subscribed: typeof selected = []
    try {
      for (const page of selected) {
        await this.providerOperation("Meta", () =>
          this.meta.subscribePage(page.id, page.accessToken)
        )
        subscribed.push(page)
      }
      const pages = await this.repository.connectPages(
        user.id,
        selected.map((page) => ({
          providerPageId: page.id,
          name: page.name,
          encryptedPageToken: encryptSecret(
            this.env.TOKEN_ENCRYPTION_KEY,
            page.accessToken
          ),
        }))
      )
      return pages.map(rpcPageDto)
    } catch (error) {
      await Promise.allSettled(
        subscribed.map((page) =>
          this.meta.unsubscribePage(page.id, page.accessToken)
        )
      )
      throw error
    }
  }

  async disconnectPage(actor: RpcActor, pageId: string): Promise<RpcPageDto> {
    const { user } = await this.requireProductAccess(actor.userId)
    const page = await this.requirePage(user.id, pageId)
    try {
      await this.meta.unsubscribePage(
        page.providerPageId,
        decryptSecret(
          this.env.TOKEN_ENCRYPTION_KEY,
          page.pageAccessTokenEncrypted
        )
      )
    } catch {
      // The local disconnect remains authoritative; Meta may already have
      // invalidated the credential.
    }
    const disconnected = await this.repository.disconnectPage(user.id, pageId)
    if (!disconnected) throw notFound("Page")
    return rpcPageDto(disconnected)
  }

  async listApiKeys(actor: RpcActor): Promise<ApiKeyDto[]> {
    const { user } = await this.requireProductAccess(actor.userId)
    return (await this.repository.listApiKeys(user.id)).map(apiKeyDto)
  }

  async createApiKey(
    actor: RpcActor,
    label: string
  ): Promise<CreatedApiKeyDto> {
    const { user } = await this.requireProductAccess(actor.userId)
    const normalizedLabel = label.trim()
    if (!normalizedLabel || normalizedLabel.length > 80) {
      throw new ContractError({
        code: "validation_error",
        message: "API key label must contain 1 to 80 characters.",
        status: 400,
      })
    }
    const generated = await generateApiKey(apiKeyPepper(this.env))
    const record = await this.repository.createApiKey({
      tenantId: user.id,
      label: normalizedLabel,
      visiblePrefix: generated.visiblePrefix,
      secretHash: generated.secretHash,
    })
    return { apiKey: generated.apiKey, record: apiKeyDto(record) }
  }

  async revokeApiKey(actor: RpcActor, apiKeyId: string): Promise<void> {
    const { user } = await this.requireProductAccess(actor.userId)
    if (!(await this.repository.revokeApiKey(user.id, apiKeyId))) {
      throw notFound("API key")
    }
  }

  async getBillingState(actor: RpcActor): Promise<BillingStateDto> {
    const user = await this.requireActor(actor)
    const [subscription, entitlement] = await Promise.all([
      this.repository.getSubscription(user.id),
      this.entitlement(user.id),
    ])
    return {
      subscription: subscription
        ? {
            status: subscription.status,
            priceLookupKey: subscription.priceLookupKey,
            currentPeriodStart:
              subscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd:
              subscription.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
      entitlement: entitlementDto(entitlement),
    }
  }

  async createCheckoutSession(
    actor: RpcActor,
    input: { priceLookupKey: string; returnUrl: string }
  ): Promise<{ url: string }> {
    const user = await this.requireActor(actor)
    if (user.waitlisted) {
      throw new ContractError({
        code: "account_waitlisted",
        message: "This account is still on the waitlist.",
        status: 403,
      })
    }
    if (!isCanonicalPlanLookupKey(input.priceLookupKey)) {
      throw planError("plan_unavailable")
    }
    const returnUrl = validateWebAppOrigin(
      this.env,
      input.returnUrl,
      "returnUrl"
    )
    if (isActiveSubscription(await this.repository.getSubscription(user.id))) {
      return this.createBillingPortalSession(actor, returnUrl)
    }
    let customerId = await this.repository.getStripeCustomerId(user.id)
    if (!customerId) {
      const customer = await this.providerOperation("Stripe", () =>
        this.stripe.customers.create(
          { email: user.email, metadata: { tenantId: user.id } },
          { idempotencyKey: `customer-create-${user.id}` }
        )
      )
      customerId = customer.id
      await this.repository.setStripeCustomerId(user.id, customerId)
    }
    const prices = await this.providerOperation("Stripe", () =>
      this.stripe.prices.list({
        lookup_keys: [input.priceLookupKey],
        limit: 1,
      })
    )
    const price = prices.data[0]
    if (!price) throw planError("plan_unavailable")
    const checkout = await this.providerOperation("Stripe", () =>
      this.stripe.checkout.sessions.create({
        mode: "subscription",
        integration_identifier: generateIntegrationIdentifier(),
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { tenantId: user.id },
        subscription_data: { metadata: { tenantId: user.id } },
        success_url: appendPath(
          returnUrl,
          "/billing/success?session_id={CHECKOUT_SESSION_ID}"
        ),
        cancel_url: appendPath(returnUrl, "/billing"),
      })
    )
    if (!checkout.url) {
      throw new ContractError({
        code: "provider_unavailable",
        message: "Stripe did not return a Checkout URL.",
        status: 502,
      })
    }
    return { url: checkout.url }
  }

  async createBillingPortalSession(
    actor: RpcActor,
    returnUrl: string
  ): Promise<{ url: string }> {
    const user = await this.requireActor(actor)
    const webAppOrigin = validateWebAppOrigin(this.env, returnUrl, "returnUrl")
    const customerId = await this.repository.getStripeCustomerId(user.id)
    if (!customerId) throw notFound("Billing customer")
    const portal = await this.providerOperation("Stripe", () =>
      this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: appendPath(webAppOrigin, "/settings"),
      })
    )
    return { url: portal.url }
  }

  async verifyCheckoutSession(
    actor: RpcActor,
    sessionId: string
  ): Promise<CheckoutVerificationDto> {
    const user = await this.requireActor(actor)
    const checkout = await this.providerOperation("Stripe", () =>
      this.stripe.checkout.sessions.retrieve(sessionId)
    )
    const tenantId = checkout.metadata?.tenantId?.trim()
    if (tenantId !== user.id) throw notFound("Checkout session")
    return { complete: checkout.status === "complete" }
  }

  async changePassword(actor: RpcActor, newPassword: string): Promise<void> {
    const user = await this.requireActor(actor)
    const passwordHash = await hashPassword(newPassword)
    if (!(await this.repository.changePassword(user.id, passwordHash))) {
      throw notFound("Account")
    }
  }

  async deleteAccount(
    actor: RpcActor,
    confirmEmail: string
  ): Promise<AccountDeletionResultDto> {
    const user = await this.requireActor(actor)
    if (normalizedEmail(confirmEmail) !== user.email) {
      throw new ContractError({
        code: "validation_error",
        message: "The confirmation email does not match this account.",
        status: 400,
      })
    }
    const context = await this.repository.loadDeletionContext(user.id)
    if (!context) throw notFound("Account")
    const unsubscribeResults = await Promise.allSettled(
      context.pages
        .filter((page) => page.status === "active")
        .map(async (page) => {
          const pageAccessToken = decryptSecret(
            this.env.TOKEN_ENCRYPTION_KEY,
            page.encryptedPageToken
          )
          await this.meta.unsubscribePage(page.providerPageId, pageAccessToken)
        })
    )
    let stripeCancellationFailed = false
    if (context.stripeSubscriptionId) {
      try {
        await this.stripe.subscriptions.cancel(context.stripeSubscriptionId)
      } catch {
        stripeCancellationFailed = true
      }
    }
    const deleted = await this.repository.deleteTenant(user.id)
    return {
      deleted,
      metaUnsubscribeFailures: unsubscribeResults.filter(
        (result) => result.status === "rejected"
      ).length,
      stripeCancellationFailed,
    }
  }

  async verifyMetaSignature(
    raw: string,
    signature: string | null
  ): Promise<void> {
    if (!signature?.startsWith("sha256=")) throw invalidSignature("Meta")
    const expected = await hmacHex(this.env.META_APP_SECRET, raw)
    if (!(await safeEqualText(signature.slice(7), expected))) {
      throw invalidSignature("Meta")
    }
  }

  async ingestMetaWebhook(
    raw: string,
    signature: string | null
  ): Promise<{ accepted: number }> {
    await this.verifyMetaSignature(raw, signature)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new ContractError({
        code: "invalid_json",
        message: "The request body is not valid JSON.",
        status: 400,
      })
    }
    const events = await extractInboundMetaEvents(parsed)
    let accepted = 0
    const accessByTenant = new Map<string, boolean>()
    const entitlementByTenant = new Map<string, Entitlement>()
    for (const event of events) {
      const page = await this.repository.getActivePageByProviderId(
        event.providerPageId
      )
      if (!page) continue
      let productAccess = accessByTenant.get(page.tenantId)
      if (productAccess === undefined) {
        const user = await this.repository.getUserById(page.tenantId)
        const subscription = await this.repository.getSubscription(
          page.tenantId
        )
        productAccess =
          Boolean(user) &&
          user?.waitlisted === false &&
          isActiveSubscription(subscription)
        accessByTenant.set(page.tenantId, productAccess)
      }
      // Meta must receive 200 for tenants that cannot use the product, but
      // their events are deliberately discarded before any persistence.
      if (!productAccess) continue
      let entitlement = entitlementByTenant.get(page.tenantId)
      if (!entitlement) {
        entitlement = await this.entitlement(page.tenantId)
        entitlementByTenant.set(page.tenantId, entitlement)
      }
      const eventId = `evt_${(
        await sha256Hex(`${event.providerPageId}:${event.providerMessageId}`)
      ).slice(0, 32)}`
      const result = await this.repository.ingestInbound({
        page,
        contactId: event.senderId,
        text: event.text,
        providerMessageId: event.providerMessageId,
        eventId,
        createdAt: event.createdAt,
        payloadVersion: WEBHOOK_PAYLOAD_VERSION,
        periodStart: entitlement.periodStart,
        deliveryEnabled: entitlement.blockCode === null,
        deliveryBlockedReason: entitlement.blockCode
          ? `account is restricted: ${entitlement.blockCode}`
          : null,
        recoverAfter: new Date(
          this.now().getTime() + RECOVERY_HANDOFF_GRACE_SECONDS * 1000
        ),
      })
      log("info", {
        entrypoint: "fetch",
        event: result.inserted
          ? "meta_inbound_persisted"
          : "meta_inbound_duplicate",
        tenantId: page.tenantId,
        eventId,
        jobId: result.jobId,
        messageId: result.messageId,
      })
      if (
        result.jobStatus === "pending" &&
        (result.inserted || result.jobAttemptCount === 0)
      ) {
        await this.env.WEBHOOK_DELIVERIES.send({
          jobId: result.jobId,
          messageId: result.messageId,
        } satisfies QueuePayload)
      }
      accepted += result.inserted ? 1 : 0
    }
    return { accepted }
  }

  async handleStripeWebhook(
    raw: string,
    signature: string | null
  ): Promise<{ received: true }> {
    if (!signature) throw invalidSignature("Stripe")
    let event: Stripe.Event
    try {
      event = await this.stripe.webhooks.constructEventAsync(
        raw,
        signature,
        this.env.STRIPE_WEBHOOK_SECRET
      )
    } catch {
      throw invalidSignature("Stripe")
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const tenantId = session.metadata?.tenantId?.trim()
      const customerId = stripeId(session.customer)
      if (tenantId && customerId) {
        await this.repository.setStripeCustomerId(tenantId, customerId)
      }
    }
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await this.applySubscription(event)
    }
    return { received: true }
  }

  private async applySubscription(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = stripeId(subscription.customer)
    const tenantId =
      subscription.metadata?.tenantId?.trim() ||
      (customerId
        ? await this.repository.getTenantIdByStripeCustomerId(customerId)
        : null)
    if (!tenantId) {
      throw new Error("Stripe subscription has no resolvable tenant")
    }
    const item = subscription.items.data[0]
    const upsert = await this.repository.upsertSubscription({
      tenantId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      priceLookupKey: item?.price.lookup_key ?? item?.price.id ?? "unknown",
      currentPeriodStart: stripeTimestamp(item?.current_period_start),
      currentPeriodEnd: stripeTimestamp(item?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      eventAt: new Date(event.created * 1000),
    })
    if (upsert.supersededSubscriptionId) {
      await this.cancelSupersededSubscription(upsert.supersededSubscriptionId)
    }
  }

  private async cancelSupersededSubscription(
    subscriptionId: string
  ): Promise<void> {
    try {
      const previous = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        { expand: ["latest_invoice.payments"] }
      )
      if (previous.status === "canceled") return
      await this.stripe.subscriptions.cancel(subscriptionId)
      const invoice = previous.latest_invoice
      const payments =
        invoice && typeof invoice !== "string"
          ? (invoice.payments?.data ?? [])
          : []
      const paymentIntentId = payments
        .map((payment) => stripeId(payment.payment.payment_intent))
        .find(Boolean)
      if (paymentIntentId) {
        await this.stripe.refunds.create({
          payment_intent: paymentIntentId,
        })
      }
    } catch {
      // Duplicate-subscription cleanup is deliberately best effort. The
      // canonical local row has already been applied in event order.
    }
  }

  private async entitlement(tenantId: string): Promise<Entitlement> {
    const [subscription, activePageCount] = await Promise.all([
      this.repository.getSubscription(tenantId),
      this.repository.countActivePages(tenantId),
    ])
    const periodStart =
      isActiveSubscription(subscription) && subscription
        ? subscription.currentPeriodStart
        : null
    const usage = periodStart
      ? await this.repository.getUsage(tenantId, periodStart)
      : 0
    return evaluateEntitlement({
      priceLookupKey:
        isActiveSubscription(subscription) && subscription
          ? subscription.priceLookupKey
          : null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      usage,
      activePageCount,
    })
  }

  private assertCanMessage(entitlement: Entitlement): void {
    if (entitlement.blockCode) throw planError(entitlement.blockCode)
  }

  private async requireActor(actor: RpcActor): Promise<UserRecord> {
    const user = await this.repository.getUserById(actor.userId)
    if (!user) throw notFound("Account")
    return user
  }

  private async requirePage(
    tenantId: string,
    pageId: string
  ): Promise<PageRecord> {
    const page = await this.repository.getPage(tenantId, pageId)
    if (!page) throw notFound("Page")
    return page
  }

  private async requireActivePage(
    tenantId: string,
    pageId: string
  ): Promise<PageRecord> {
    const page = await this.requirePage(tenantId, pageId)
    if (page.status !== "active") throw notFound("Page")
    return page
  }

  private async requireActiveSubscription(
    tenantId: string
  ): Promise<SubscriptionRecord> {
    const subscription = await this.repository.getSubscription(tenantId)
    if (!isActiveSubscription(subscription) || !subscription) {
      throw new ContractError({
        code: "subscription_required",
        message: "An active subscription is required.",
        status: 403,
      })
    }
    return subscription
  }

  private async providerOperation<T>(
    provider: "Meta" | "Stripe",
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ContractError) throw error
      throw new ContractError({
        code: "provider_unavailable",
        message: `${provider} is temporarily unavailable.`,
        status: 502,
      })
    }
  }
}

function entitlementDto(entitlement: Entitlement) {
  return {
    priceLookupKey: entitlement.priceLookupKey,
    usage: entitlement.usage,
    messageLimit: entitlement.limits?.messagesPerPeriod ?? null,
    activePageCount: entitlement.activePageCount,
    pageLimit: entitlement.limits?.maxPages ?? null,
    blockCode: entitlement.blockCode,
    noticeLevel: entitlementNoticeLevel(entitlement),
  }
}

function userDto(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    waitlisted: user.waitlisted,
    createdAt: user.createdAt.toISOString(),
  }
}

function apiKeyDto(apiKey: ApiKeyDto): ApiKeyDto {
  return {
    id: apiKey.id,
    label: apiKey.label,
    visiblePrefix: apiKey.visiblePrefix,
    status: apiKey.status,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
  }
}

function isActiveSubscription(
  subscription: SubscriptionRecord | null
): boolean {
  return subscription?.status === "active"
}

function normalizeEmail(value: string): string {
  const email = normalizedEmail(value)
  if (!email) {
    throw new ContractError({
      code: "validation_error",
      message: "A valid email is required.",
      status: 400,
    })
  }
  return email
}

function normalizedEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email) ? email : null
}

function invalidApiKey(): ContractError {
  return new ContractError({
    code: "invalid_api_key",
    message: "The API key is invalid or revoked.",
    status: 401,
  })
}

function idempotencyConflict(
  reason: "fingerprint" | "legacy" | "in_progress"
): ContractError {
  return new ContractError({
    code: "idempotency_conflict",
    message:
      reason === "in_progress"
        ? "A request with this idempotency key is still in progress."
        : "The idempotency key was already used for another request.",
    status: 409,
  })
}

function notFound(resource: string): ContractError {
  return new ContractError({
    code: "not_found",
    message: `${resource} was not found.`,
    status: 404,
  })
}

function planError(code: Entitlement["blockCode"]): ContractError {
  if (!code) throw new Error("missing plan error")
  const result = entitlementHttpError(code)
  return new ContractError({
    code,
    message: result.message,
    status: result.status,
  })
}

function providerAuthorizationRequired(): ContractError {
  return new ContractError({
    code: "provider_rejected",
    message: "Authorize Meta before selecting Pages.",
    status: 422,
  })
}

function invalidSignature(provider: string): ContractError {
  return new ContractError({
    code: "invalid_signature",
    message: `${provider} webhook signature verification failed.`,
    status: 400,
  })
}

function validateMetaRedirectUri(env: Env, value: string): string {
  const url = parseUrlInput(value, "redirectUri")
  const origin = validateAllowedWebAppUrl(env, url, "redirectUri")
  if (
    url.origin !== origin ||
    url.pathname !== "/api/meta/callback" ||
    url.search ||
    url.hash
  ) {
    throw invalidWebAppUrl(
      "redirectUri",
      "Meta redirect URI must be the configured callback URL."
    )
  }
  return `${origin}/api/meta/callback`
}

function validateWebAppOrigin(
  env: Env,
  value: string,
  field: "returnUrl"
): string {
  const url = parseUrlInput(value, field)
  const origin = validateAllowedWebAppUrl(env, url, field)
  if (url.origin !== origin || url.pathname !== "/" || url.search || url.hash) {
    throw invalidWebAppUrl(
      field,
      "Return URL must be an allowed web application origin."
    )
  }
  return origin
}

function parseUrlInput(value: string, field: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidWebAppUrl(field, "A valid URL is required.")
  }
  if (url.username || url.password) {
    throw invalidWebAppUrl(field, "URLs cannot contain credentials.")
  }
  return url
}

function validateAllowedWebAppUrl(env: Env, url: URL, field: string): string {
  const origins = configuredWebAppOrigins(env)
  if (!origins.has(url.origin)) {
    throw invalidWebAppUrl(
      field,
      "URL origin is not allowed for this environment."
    )
  }
  return url.origin
}

function configuredWebAppOrigins(env: Env): Set<string> {
  const raw = envText(env, "WEB_APP_ORIGINS")
  if (!raw) throw incompleteConfiguration()
  let values: unknown
  try {
    values = JSON.parse(raw)
  } catch {
    throw incompleteConfiguration()
  }
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => typeof value !== "string")
  ) {
    throw incompleteConfiguration()
  }
  const origins = new Set<string>()
  for (const value of values) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw incompleteConfiguration()
    }
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      ["development", "local"].includes(env.ENVIRONMENT)
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== value.replace(/\/$/u, "")
    ) {
      throw incompleteConfiguration()
    }
    origins.add(url.origin)
  }
  return origins
}

function envText(env: Env, key: string): string | undefined {
  if (!(key in env)) return undefined
  const value = Reflect.get(env, key)
  return typeof value === "string" ? value : undefined
}

function invalidWebAppUrl(field: string, message: string): ContractError {
  return new ContractError({
    code: "validation_error",
    message,
    status: 400,
    details: [{ path: field, message }],
  })
}

function incompleteConfiguration(): ContractError {
  return new ContractError({
    code: "internal_error",
    message: "The API is not fully configured.",
    status: 500,
  })
}

function appendPath(origin: string, path: string): string {
  return new URL(path, origin).toString()
}

function stripeId(
  value: string | { id: string } | null | undefined
): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    ("code" in error
      ? (error as Error & { code?: string }).code === "23505"
      : error.message.includes("unique"))
  )
}

function requiredConfiguration(env: Env): void {
  const required = [
    "DATABASE_URL",
    "TOKEN_ENCRYPTION_KEY",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_VERIFY_TOKEN",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ] as const
  if (required.some((key) => !env[key])) {
    throw incompleteConfiguration()
  }
  configuredWebAppOrigins(env)
  apiKeyPepper(env)
}

export const PLAN_LOOKUP_KEYS = Object.keys(PLAN_LIMITS)
export type StoredOutboundMessage = MessageRecord

function apiKeyPepper(env: Env): string {
  const value = env.API_KEY_PEPPER || env.AUTH_SECRET
  if (!value) {
    throw new ContractError({
      code: "internal_error",
      message: "The API is not fully configured.",
      status: 500,
    })
  }
  return value
}
