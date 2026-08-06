import type {
  AccountDeletionResultDto,
  ApiKeyDto,
  BillingStateDto,
  CheckoutVerificationDto,
  CommentDto,
  CommentListInput,
  CommentReplyInput,
  ConnectInstagramAccountInput,
  ConnectMetaPagesInput,
  ConversationListDto,
  ConversationListInput,
  ConversationThreadDto,
  CreatedApiKeyDto,
  DeliveryDto,
  MeDto,
  MessageDto,
  MessageListInput,
  MetaAuthorizationResultDto,
  MetaPageSelectionDto,
  PageDto,
  PageListQuery,
  PaginationDto,
  PrivateReplyInput,
  ProductAccessDto,
  ProductShellDto,
  RpcActor,
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
  evaluateEntitlement,
  isCanonicalPlanLookupKey,
  PLAN_LIMITS,
  type Entitlement,
} from "../domain/entitlements"
import { extractInstagramComments } from "../domain/instagram-comments"
import { extractInstagramDirectMessages } from "../domain/instagram-events"
import { extractInboundMetaEvents } from "../domain/meta-events"
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
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
  commentDto,
  messageDto,
  pageDto,
  SqlRepository,
  type CommentRecord,
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
  INSTAGRAM_COMMENT_MAX_CHARS,
  INSTAGRAM_TEXT_MAX_BYTES,
  instagramCommentLength,
  instagramTextByteLength,
  InstagramClient,
} from "../infrastructure/meta/instagram-client"
import {
  createStripeClient,
  stripeTimestamp,
} from "../infrastructure/stripe/client"
import { log } from "../observability/logger"

export type QueuePayload = {
  jobId: string
  // Contexto de log, no identidad: el job ya sabe de qué cuelga. Exactamente uno
  // de los dos viene informado.
  messageId?: string
  commentId?: string
}

export type AuthenticatedApiKey = {
  tenantId: string
  apiKeyId: string
}

export class ApiService {
  readonly meta: MetaClient
  readonly instagram: InstagramClient
  private repositoryClient: SqlRepository | null = null
  private stripeClient: Stripe | null = null
  private readonly now: () => Date

  constructor(
    readonly env: Env,
    dependencies: {
      repository?: SqlRepository
      meta?: MetaClient
      instagram?: InstagramClient
      stripe?: Stripe
      now?: () => Date
    } = {}
  ) {
    this.repositoryClient = dependencies.repository ?? null
    this.meta =
      dependencies.meta ?? new MetaClient(env.META_APP_ID, env.META_APP_SECRET)
    // Credenciales propias: el App Secret de Instagram es **distinto** del de
    // Facebook aunque vivan en la misma app de Meta. Firma el webhook de
    // Instagram y es el `client_secret` del OAuth.
    this.instagram =
      dependencies.instagram ??
      new InstagramClient(env.INSTAGRAM_APP_ID, env.INSTAGRAM_APP_SECRET)
    this.stripeClient = dependencies.stripe ?? null
    this.now = dependencies.now ?? (() => new Date())
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
    const pageBeforeUpdate = await this.requirePage(tenantId, pageId)
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
    await this.requirePage(tenantId, pageId)
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
    input: { limit: number; cursor?: string }
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
    // El esquema tope en 2000 caracteres, que es el techo de Messenger.
    // Instagram corta antes y en otra unidad, y recién acá se sabe a qué canal
    // apunta el `pageId`.
    if (page.channel === "instagram")
      assertInstagramTextFits(input.message.text)
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

    const accessToken = decryptSecret(
      this.env.TOKEN_ENCRYPTION_KEY,
      page.pageAccessTokenEncrypted
    )
    // Un DM por Instagram y uno por Messenger son la misma operación del
    // producto y dos requests distintas: otro host, el token en el header en vez
    // de en la query, y sin `messaging_type`. El canal de la cuenta es lo único
    // que decide, y se resolvió una sola vez con la fila.
    const result =
      page.channel === "instagram"
        ? await this.instagram.sendText({
            accessToken,
            recipientId: input.message.recipientId,
            text: input.message.text,
          })
        : await this.meta.sendText({
            pageAccessToken: accessToken,
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

  listComments(
    tenantId: string,
    input: CommentListInput
  ): Promise<{ data: CommentDto[]; pagination: PaginationDto }> {
    return this.repository.listComments(tenantId, input)
  }

  async getComment(tenantId: string, commentId: string): Promise<CommentDto> {
    return commentDto(await this.requireComment(tenantId, commentId))
  }

  async listCommentDeliveries(
    tenantId: string,
    commentId: string,
    input: { limit: number; cursor?: string }
  ): Promise<{ data: DeliveryDto[]; pagination: PaginationDto }> {
    await this.requireComment(tenantId, commentId)
    return this.repository.listCommentDeliveries(tenantId, commentId, input)
  }

  // Respuesta **pública**: se publica debajo del comentario, visible para
  // cualquiera que mire la publicación.
  //
  // La idempotencia importa más acá que en un DM: Instagram no pone ningún
  // límite de una respuesta por comentario en este endpoint —ese límite es de la
  // respuesta privada—, así que un reintento sin clave publica un segundo
  // comentario visible que hay que ir a borrar a mano.
  async replyToComment(input: {
    tenantId: string
    commentId: string
    idempotencyKey: string | null
    reply: CommentReplyInput
  }): Promise<{ comment: CommentDto; replayed: boolean; created: boolean }> {
    const key = requireIdempotencyKey(input.idempotencyKey)
    if (
      instagramCommentLength(input.reply.text) > INSTAGRAM_COMMENT_MAX_CHARS
    ) {
      throw tooLong(
        `An Instagram comment allows ${INSTAGRAM_COMMENT_MAX_CHARS} characters and this reply has ${instagramCommentLength(
          input.reply.text
        )}.`
      )
    }

    const replay = await this.repository.getOutboundCommentByIdempotency(
      input.tenantId,
      key
    )
    if (replay) {
      return { comment: commentDto(replay), replayed: true, created: false }
    }

    const { page, source } = await this.requireCommentTarget(
      input.tenantId,
      input.commentId
    )
    const providerCommentId = requirePublishedComment(source)
    const result = await this.instagram.replyToComment({
      accessToken: decryptSecret(
        this.env.TOKEN_ENCRYPTION_KEY,
        page.pageAccessTokenEncrypted
      ),
      providerCommentId,
      text: input.reply.text,
    })
    if (!result.ok && result.kind === "invalid_token") {
      await this.repository.markPageTokenInvalid({
        tenantId: input.tenantId,
        pageId: page.id,
        error: result.message,
      })
    }

    // Se persiste igual que un saliente rechazado en Messenger: el fallo es lo
    // que el usuario necesita poder ver en el log.
    const persisted = await this.repository.insertOutboundComment({
      tenantId: input.tenantId,
      pageId: page.id,
      providerCommentId: result.ok ? result.commentId : null,
      parentCommentId: providerCommentId,
      mediaId: source.mediaId,
      mediaProductType: source.mediaProductType,
      // Quien comenta es la propia cuenta: la respuesta sale de ella. Guardar su
      // IG ID y no el del comentador hace que la fila se lea igual que el
      // comentario que va a volver por el webhook, que es lo que la tercera
      // señal anti-bucle compara.
      fromProviderUserId: page.providerPageId,
      fromUsername: page.username,
      status: result.ok ? "sent" : "failed",
      text: input.reply.text,
      idempotencyKey: key,
      error: result.ok ? null : result.message,
      providerResponse: result.response,
      createdAt: this.now(),
    })
    if (result.ok) {
      return { comment: commentDto(persisted), replayed: false, created: true }
    }
    throw providerFailure(result.kind, result.message, persisted.id)
  }

  // Respuesta **privada**: un DM a quien comentó, amparado en el comentario.
  // Es la única forma de escribirle primero a alguien que nunca mandó un DM: la
  // ventana de 24 horas no aplica y en su lugar rigen dos reglas de Meta —7 días
  // desde el comentario y **una sola** respuesta por comentario.
  //
  // Se persiste en `messages` y no en `instagram_comments`, porque es un DM: lo
  // único que lo distingue de uno normal es `instagram_source_comment_id`.
  async sendPrivateReply(input: {
    tenantId: string
    commentId: string
    idempotencyKey: string | null
    reply: PrivateReplyInput
  }): Promise<{ message: MessageDto; replayed: boolean; created: boolean }> {
    const key = requireIdempotencyKey(input.idempotencyKey)
    assertInstagramTextFits(input.reply.text)

    const replay = await this.repository.getOutboundByIdempotency(
      input.tenantId,
      key
    )
    if (replay) {
      return { message: messageDto(replay), replayed: true, created: false }
    }

    const { page, source } = await this.requireCommentTarget(
      input.tenantId,
      input.commentId
    )
    const providerCommentId = requirePublishedComment(source)

    // El límite de una sola respuesta privada, chequeado antes de llamar. Meta
    // también lo aplica, pero con un 100/2534025 que junta cuatro causas —vencida,
    // ya contestada, borrada, o el usuario no acepta mensajes— y el usuario no
    // puede saber cuál fue. Acá lo sabemos con certeza.
    const alreadyReplied = await this.repository.getPrivateReplyForComment({
      tenantId: input.tenantId,
      providerCommentId,
    })
    if (alreadyReplied) {
      throw new ContractError({
        code: "idempotency_conflict",
        message:
          "This comment already received a private reply. Instagram allows exactly one per comment.",
        status: 409,
        details: [
          {
            message: "The existing private reply was not replaced.",
            messageId: alreadyReplied.id,
          },
        ],
      })
    }

    // El destinatario sale del comentario guardado y no del body: es lo que
    // impide usar el comentario de una persona como excusa para escribirle a
    // otra.
    const contactId = source.fromProviderUserId
    const conversation = await this.repository.upsertConversation({
      tenantId: input.tenantId,
      pageId: page.id,
      contactId,
      at: this.now(),
    })

    const fingerprint = await sha256Hex(
      JSON.stringify({
        kind: "private_reply",
        commentId: providerCommentId,
        pageId: page.id,
        text: input.reply.text,
      })
    )
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

    const result = await this.instagram.sendPrivateReply({
      accessToken: decryptSecret(
        this.env.TOKEN_ENCRYPTION_KEY,
        page.pageAccessTokenEncrypted
      ),
      providerCommentId,
      text: input.reply.text,
    })
    const persisted = await this.repository.completeOutbound({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      pageId: page.id,
      contactId,
      text: input.reply.text,
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.ok ? result.messageId : null,
      idempotencyKey: key,
      fingerprint,
      error: result.ok ? null : result.message,
      providerResponse: result.response,
      createdAt: this.now(),
      // Instagram no consume cuota: sin período no hay contador que incrementar.
      periodStart: null,
      // Lo que convierte este DM en una respuesta privada auditable. Se guarda
      // también cuando Meta rechazó: el intento fallido no consumió la única
      // respuesta disponible —por eso el chequeo de arriba solo mira los
      // `sent`— pero sí queda en el log.
      sourceCommentId: providerCommentId,
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
    throw providerFailure(result.kind, result.message, persisted.id)
  }

  // Despachador por canal, y no una llamada directa a `unsubscribePage`. Mandar
  // el token de una cuenta de Instagram al Graph de Facebook **no da un error
  // claro, da un 400**: se registra como «Meta no confirmó» y la cuenta queda
  // recibiendo eventos. Son dos los llamadores —desconectar y borrar la
  // cuenta— y los dos tienen que elegir igual.
  private unsubscribeByChannel(
    channel: PageRecord["channel"],
    providerPageId: string,
    accessToken: string
  ): Promise<void> {
    return channel === "instagram"
      ? this.instagram.unsubscribeAccount(accessToken)
      : this.meta.unsubscribePage(providerPageId, accessToken)
  }

  private async requireComment(
    tenantId: string,
    commentId: string
  ): Promise<CommentRecord> {
    const comment = await this.repository.getComment(tenantId, commentId)
    if (!comment) throw notFound("Comment")
    return comment
  }

  // Resuelve el comentario a contestar y la cuenta que responde. Se exige que el
  // comentario esté en la base porque de ahí salen la publicación a la que
  // pertenece y el IGSID de quien comentó, que Meta no devuelve; en la práctica
  // siempre está, porque el tenant conoce el id justamente porque Resender se lo
  // entregó.
  private async requireCommentTarget(
    tenantId: string,
    commentId: string
  ): Promise<{ page: PageRecord; source: CommentRecord }> {
    const source = await this.requireComment(tenantId, commentId)
    if (source.direction !== "inbound") {
      throw new ContractError({
        code: "validation_error",
        message: "Only inbound comments can be replied to.",
        status: 400,
      })
    }
    const page = await this.requirePage(tenantId, source.pageId)
    if (page.status !== "active") throw notFound("Page")
    if (page.tokenStatus !== "valid") {
      throw new ContractError({
        code: "provider_rejected",
        message:
          "The Instagram access token is invalid. Reconnect the account.",
        status: 422,
      })
    }
    return { page, source }
  }

  // Conecta la cuenta de Instagram, en el orden que importa: intercambio →
  // perfil → **suscripción al webhook** → persistencia.
  //
  // Una cuenta guardada que no recibe eventos se ve conectada y está muda; una
  // suscripción sin fila en la base no le hace nada a nadie y se limpia sola al
  // reintentar. Por eso la suscripción va antes que el insert.
  async connectInstagramAccount(
    actor: RpcActor,
    input: ConnectInstagramAccountInput
  ): Promise<PageDto> {
    const { user } = await this.requireProductAccess(actor.userId)
    validateReturnUrl(input.redirectUri)

    const token = await this.providerOperation("Instagram", () =>
      this.instagram.exchangeAuthorizationCode({
        code: input.code,
        redirectUri: input.redirectUri,
      })
    )
    const profile = await this.providerOperation("Instagram", () =>
      this.instagram.getProfile(token.accessToken)
    )
    await this.providerOperation("Instagram", () =>
      this.instagram.subscribeAccount(token.accessToken)
    )

    const page = await this.repository.connectInstagramAccount({
      tenantId: user.id,
      providerAccountId: profile.providerAccountId,
      name: profile.name,
      username: profile.username,
      encryptedAccessToken: encryptSecret(
        this.env.TOKEN_ENCRYPTION_KEY,
        token.accessToken
      ),
      tokenExpiresAt: token.expiresAt,
    })
    // El upsert no devuelve fila cuando el `where` del `do update` no aplica, y
    // eso solo pasa si la cuenta ya es de otro tenant. Una cuenta pertenece a
    // uno solo, sin transferencia automática (ADR 0004).
    if (!page) {
      throw new ContractError({
        code: "provider_rejected",
        message:
          "This Instagram account is already connected to another Resender account.",
        status: 422,
      })
    }
    return pageDto(page)
  }

  async authenticateCredentials(input: {
    email: string
    password: string
  }): Promise<ReturnType<typeof userDto> | null> {
    const user = await this.repository.getUserByEmail(
      normalizeEmail(input.email)
    )
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
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
        destination: "billing",
      }
    }
    const subscription = await this.repository.getSubscription(user.id)
    const subscriptionActive = isActiveSubscription(subscription)
    return {
      userExists: true,
      waitlisted: user.waitlisted,
      subscriptionActive,
      destination: user.waitlisted
        ? "waitlist"
        : subscriptionActive
          ? "product"
          : "billing",
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
    validateReturnUrl(input.redirectUri)
    const token = await this.providerOperation("Meta", () =>
      this.meta.exchangeAuthorizationCode(input)
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
  ): Promise<PageDto[]> {
    const { user } = await this.requireProductAccess(actor.userId)
    const ids = [...new Set(input.providerPageIds)]
    if (ids.length === 0) return []
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
      return await this.repository.connectPages(
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
    } catch (error) {
      await Promise.allSettled(
        subscribed.map((page) =>
          this.meta.unsubscribePage(page.id, page.accessToken)
        )
      )
      throw error
    }
  }

  async disconnectPage(actor: RpcActor, pageId: string): Promise<PageDto> {
    const { user } = await this.requireProductAccess(actor.userId)
    const page = await this.requirePage(user.id, pageId)
    try {
      await this.unsubscribeByChannel(
        page.channel,
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
    return disconnected
  }

  async listApiKeys(actor: RpcActor): Promise<ApiKeyDto[]> {
    const { user } = await this.requireProductAccess(actor.userId)
    return this.repository.listApiKeys(user.id)
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
    return { apiKey: generated.apiKey, record }
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
    const returnUrl = validateReturnUrl(input.returnUrl)
    if (isActiveSubscription(await this.repository.getSubscription(user.id))) {
      return this.createBillingPortalSession(
        actor,
        appendPath(returnUrl, "/settings")
      )
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
    const customerId = await this.repository.getStripeCustomerId(user.id)
    if (!customerId) throw notFound("Billing customer")
    const portal = await this.providerOperation("Stripe", () =>
      this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: validateReturnUrl(returnUrl),
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
    if (confirmEmail !== user.email) {
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
        .map((page) =>
          this.unsubscribeByChannel(
            page.channel,
            page.providerPageId,
            decryptSecret(
              this.env.TOKEN_ENCRYPTION_KEY,
              page.encryptedPageToken
            )
          )
        )
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
        event.providerPageId,
        "messenger"
      )
      if (!page) continue
      // Meta must receive 200 for tenants that cannot use the product, but
      // their events are deliberately discarded before any persistence.
      if (!(await this.hasProductAccess(page.tenantId, accessByTenant))) {
        continue
      }
      let entitlement = entitlementByTenant.get(page.tenantId)
      if (!entitlement) {
        entitlement = await this.entitlement(page.tenantId)
        entitlementByTenant.set(page.tenantId, entitlement)
      }
      const eventId = await this.eventId(
        `${event.providerPageId}:${event.providerMessageId}`
      )
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
        recoverAfter: this.recoverAfter(),
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
      await this.enqueueIfPending(result, { messageId: result.messageId })
      accepted += result.inserted ? 1 : 0
    }
    return { accepted }
  }

  async verifyInstagramSignature(
    raw: string,
    signature: string | null
  ): Promise<void> {
    if (!signature?.startsWith("sha256=")) throw invalidSignature("Instagram")
    // `INSTAGRAM_APP_SECRET` y no `META_APP_SECRET`: firmar un webhook de
    // Instagram con el secreto de Facebook es el error de configuración más
    // común de esta integración, y es la razón por la que Instagram entra por
    // una ruta propia en vez de compartir `/webhooks/meta`. Con rutas separadas
    // la pregunta «¿con cuál verifico?» no existe.
    const expected = await hmacHex(this.env.INSTAGRAM_APP_SECRET, raw)
    if (!(await safeEqualText(signature.slice(7), expected))) {
      throw invalidSignature("Instagram")
    }
  }

  // Webhook de Instagram: mensajes directos **y** comentarios. Un mismo POST de
  // Meta puede traer las dos cosas —viajan en ramas distintas del mismo
  // `entry`—, así que se procesan las dos y se suman los aceptados.
  //
  // Los DMs comparten toda la ingesta con Messenger a propósito: cambia el
  // payload —y por eso cambia el parser— pero no cambian el dedupe por índice,
  // la resolución cuenta→tenant, los gates, la cola de entrega ni la política de
  // reintentos.
  async ingestInstagramWebhook(
    raw: string,
    signature: string | null
  ): Promise<{ accepted: number }> {
    await this.verifyInstagramSignature(raw, signature)
    const parsed = parseWebhookJson(raw)
    const accessByTenant = new Map<string, boolean>()

    const messages = await this.ingestInstagramMessages(parsed, accessByTenant)
    const comments = await this.ingestInstagramComments(parsed, accessByTenant)
    return { accepted: messages + comments }
  }

  private async ingestInstagramMessages(
    parsed: unknown,
    accessByTenant: Map<string, boolean>
  ): Promise<number> {
    let accepted = 0
    for (const event of extractInstagramDirectMessages(parsed)) {
      const page = await this.repository.getActivePageByProviderId(
        event.providerAccountId,
        "instagram"
      )
      if (!page) continue
      if (!(await this.hasProductAccess(page.tenantId, accessByTenant))) {
        continue
      }

      const eventId = await this.eventId(
        `${event.providerAccountId}:${event.providerMessageId}`
      )
      const result = await this.repository.ingestInbound({
        page,
        contactId: event.senderId,
        text: event.text,
        providerMessageId: event.providerMessageId,
        eventId,
        createdAt: event.createdAt,
        payloadVersion: WEBHOOK_PAYLOAD_VERSION,
        // Instagram está **fuera de cuota** por ahora: sin período no hay
        // contador que incrementar, y por eso tampoco se resuelve el
        // entitlement — sería una ida a la base por evento sin nada que decidir.
        periodStart: null,
        // La contracara: la restricción por consumo tampoco lo frena. Un tenant
        // que agotó su cuota de Messenger sigue recibiendo sus DMs de Instagram.
        deliveryEnabled: true,
        deliveryBlockedReason: null,
        recoverAfter: this.recoverAfter(),
      })
      log("info", {
        entrypoint: "fetch",
        event: result.inserted
          ? "instagram_inbound_persisted"
          : "instagram_inbound_duplicate",
        tenantId: page.tenantId,
        eventId,
        jobId: result.jobId,
        messageId: result.messageId,
      })
      await this.enqueueIfPending(result, { messageId: result.messageId })
      accepted += result.inserted ? 1 : 0
    }
    return accepted
  }

  private async ingestInstagramComments(
    parsed: unknown,
    accessByTenant: Map<string, boolean>
  ): Promise<number> {
    let accepted = 0
    for (const event of extractInstagramComments(parsed)) {
      const page = await this.repository.getActivePageByProviderId(
        event.providerAccountId,
        "instagram"
      )
      if (!page) continue

      // **Segunda señal anti-bucle.** El parser ya descartó los comentarios
      // cuyo `from.id` es la propia cuenta; acá se repite por @handle, que es el
      // otro dato que identifica a la cuenta y que el parser no puede consultar
      // porque vive en la base.
      if (
        page.username &&
        event.fromUsername &&
        event.fromUsername.toLowerCase() === page.username.toLowerCase()
      ) {
        continue
      }

      // **Tercera señal anti-bucle**, y la única que no depende del `from` que
      // manda Meta: preguntar si ese id es de un comentario que publicamos
      // nosotros. Va última porque es la única que consulta la base.
      if (
        await this.repository.isOwnPublishedComment({
          pageId: page.id,
          providerCommentId: event.providerCommentId,
        })
      ) {
        continue
      }

      if (!(await this.hasProductAccess(page.tenantId, accessByTenant))) {
        continue
      }

      const eventId = await this.eventId(
        `${event.providerAccountId}:comment:${event.providerCommentId}`
      )
      const result = await this.repository.ingestInboundComment({
        page,
        providerCommentId: event.providerCommentId,
        parentCommentId: event.parentCommentId,
        mediaId: event.mediaId,
        mediaProductType: event.mediaProductType,
        fromProviderUserId: event.fromProviderUserId,
        fromUsername: event.fromUsername,
        text: event.text,
        eventId,
        createdAt: event.createdAt,
        payloadVersion: WEBHOOK_PAYLOAD_VERSION,
        deliveryEnabled: true,
        deliveryBlockedReason: null,
        recoverAfter: this.recoverAfter(),
      })
      log("info", {
        entrypoint: "fetch",
        event: result.inserted
          ? "instagram_comment_persisted"
          : "instagram_comment_duplicate",
        tenantId: page.tenantId,
        eventId,
        jobId: result.jobId,
        commentId: result.commentId,
      })
      await this.enqueueIfPending(result, { commentId: result.commentId })
      accepted += result.inserted ? 1 : 0
    }
    return accepted
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

  // Bloqueo total sin acceso al producto (ADR 0002), común a los dos webhooks.
  // La caché es por payload: un mismo POST de Meta puede traer varios eventos
  // del mismo tenant.
  private async hasProductAccess(
    tenantId: string,
    cache: Map<string, boolean>
  ): Promise<boolean> {
    const cached = cache.get(tenantId)
    if (cached !== undefined) return cached
    const [user, subscription] = await Promise.all([
      this.repository.getUserById(tenantId),
      this.repository.getSubscription(tenantId),
    ])
    const allowed =
      Boolean(user) &&
      user?.waitlisted === false &&
      isActiveSubscription(subscription)
    cache.set(tenantId, allowed)
    return allowed
  }

  private async eventId(source: string): Promise<string> {
    return `evt_${(await sha256Hex(source)).slice(0, 32)}`
  }

  private recoverAfter(): Date {
    return new Date(
      this.now().getTime() + RECOVERY_HANDOFF_GRACE_SECONDS * 1000
    )
  }

  private async enqueueIfPending(
    result: {
      inserted: boolean
      jobId: string
      jobStatus: string
      jobAttemptCount: number
    },
    subject: { messageId?: string; commentId?: string }
  ): Promise<void> {
    if (result.jobStatus !== "pending") return
    if (!result.inserted && result.jobAttemptCount !== 0) return
    await this.env.WEBHOOK_DELIVERIES.send({
      jobId: result.jobId,
      ...subject,
    } satisfies QueuePayload)
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
    provider: "Meta" | "Instagram" | "Stripe",
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

function isActiveSubscription(
  subscription: SubscriptionRecord | null
): boolean {
  return subscription?.status === "active"
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
    throw new ContractError({
      code: "validation_error",
      message: "A valid email is required.",
      status: 400,
    })
  }
  return email
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

function requireIdempotencyKey(value: string | null): string {
  const key = value?.trim()
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ContractError({
      code: "validation_error",
      message:
        "Idempotency-Key is required and must be at most 200 characters.",
      status: 400,
      details: [{ path: "Idempotency-Key", message: "Invalid header value" }],
    })
  }
  return key
}

// El límite del DM se cuenta en **bytes UTF-8** y no en caracteres: cada acento
// son 2 bytes y cada emoji 4, así que un texto que cabe en caracteres puede no
// caber. Se valida antes de llamar porque el rechazo de Instagram no dice cuánto
// sobró.
function assertInstagramTextFits(text: string): void {
  const bytes = instagramTextByteLength(text)
  if (bytes > INSTAGRAM_TEXT_MAX_BYTES) {
    throw tooLong(
      `Instagram allows ${INSTAGRAM_TEXT_MAX_BYTES} UTF-8 bytes and this message has ${bytes}.`
    )
  }
}

function tooLong(message: string): ContractError {
  return new ContractError({
    code: "validation_error",
    message,
    status: 400,
    details: [{ path: "text", message }],
  })
}

// Un comentario saliente que Meta rechazó no tiene `ig_comment_id`, así que no
// se le puede contestar: no existe del lado de Instagram.
function requirePublishedComment(comment: CommentRecord): string {
  if (!comment.providerCommentId) throw notFound("Comment")
  return comment.providerCommentId
}

function providerFailure(
  kind: "invalid_token" | "rejected" | "unavailable",
  message: string,
  persistedId: string
): ContractError {
  return new ContractError({
    code: kind === "unavailable" ? "provider_unavailable" : "provider_rejected",
    message,
    status: kind === "unavailable" ? 502 : 422,
    details: [
      { message: "The failed attempt was persisted.", messageId: persistedId },
    ],
  })
}

function parseWebhookJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new ContractError({
      code: "invalid_json",
      message: "The request body is not valid JSON.",
      status: 400,
    })
  }
}

function invalidSignature(provider: string): ContractError {
  return new ContractError({
    code: "invalid_signature",
    message: `${provider} webhook signature verification failed.`,
    status: 400,
  })
}

function validateReturnUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ContractError({
      code: "validation_error",
      message: "A valid return URL is required.",
      status: 400,
    })
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  ) {
    throw new ContractError({
      code: "validation_error",
      message: "Return URLs must use HTTPS outside localhost.",
      status: 400,
    })
  }
  if (url.username || url.password) {
    throw new ContractError({
      code: "validation_error",
      message: "Return URLs cannot contain credentials.",
      status: 400,
    })
  }
  return url.toString()
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
    throw new ContractError({
      code: "internal_error",
      message: "The API is not fully configured.",
      status: 500,
    })
  }
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
