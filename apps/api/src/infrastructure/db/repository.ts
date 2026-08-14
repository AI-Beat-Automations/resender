import type {
  ApiKeyDto,
  AttachmentDto,
  Channel,
  CommentDto,
  CommentListInput,
  ConversationDto,
  ConversationListInput,
  DeliveryDto,
  DeliveryStatus,
  MessageContent,
  MessageDto,
  MessageListInput,
  MessageOrigin,
  MessageType,
  PageDto,
  PageListQuery,
  PaginationDto,
} from "@workspace/contracts"

import { API_MAX_LIMIT } from "../../config"
import { decodeCursor, encodeCursor } from "../../domain/cursor"
import {
  findSupersededSubscriptionId,
  shouldApplySubscriptionEvent,
} from "../../domain/subscriptions"
import type {
  WhatsappContactSyncEvent,
  WhatsappError,
  WhatsappMessageEvent,
  WhatsappStatusEvent,
} from "../../domain/whatsapp-events"
import type { Sql } from "./client"

export type UserRecord = {
  id: string
  email: string
  passwordHash: string
  waitlisted: boolean
  createdAt: Date
}

export type SubscriptionRecord = {
  tenantId: string
  stripeSubscriptionId: string
  status: string
  priceLookupKey: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  lastStripeEventAt: Date | null
}

export type SubscriptionUpsertInput = {
  tenantId: string
  stripeSubscriptionId: string
  status: string
  priceLookupKey: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  eventAt: Date
}

export type SubscriptionUpsertResult = {
  applied: boolean
  supersededSubscriptionId: string | null
}

export type PageRecord = {
  id: string
  tenantId: string
  // Discrimina Página de Facebook de cuenta profesional de Instagram. Desde la
  // migración 0013 `meta_page_id` solo es único **dentro** de un canal, así que
  // cualquier resolución por ese id sin decir el canal es ambigua.
  channel: Channel
  providerPageId: string
  name: string
  // El @handle. Null en Messenger.
  username: string | null
  status: "active" | "disconnected"
  tokenStatus: "valid" | "invalid"
  tokenError: string | null
  // Null en Messenger: los page tokens no vencen. En Instagram vence a los ~60
  // días y es la fecha que lee el refresh.
  tokenExpiresAt: Date | null
  webhookUrl: string | null
  pageAccessTokenEncrypted: string
  webhookSigningSecretEncrypted: string | null
  // Identidad de WhatsApp (migración 0015). Null en messenger/instagram, y
  // también en consultas que todavía no seleccionan las columnas: el mapeo es
  // tolerante a la ausencia, igual que `channel()`.
  wabaId: string | null
  phoneE164: string | null
  onboardingMode: "standard" | "coexistence" | null
  coexistenceStatus: string | null
  historySyncStatus: string | null
  connectedAt: Date
  updatedAt: Date
}

export type CommentRecord = {
  id: string
  tenantId: string
  pageId: string
  providerCommentId: string | null
  parentCommentId: string | null
  mediaId: string
  mediaProductType: string | null
  fromProviderUserId: string
  fromUsername: string | null
  direction: "inbound" | "outbound"
  status: "received" | "sent" | "failed"
  text: string
  error: string | null
  idempotencyKey: string | null
  createdAt: Date
}

export type MessageRecord = {
  id: string
  tenantId: string
  conversationId: string
  pageId: string
  contactId: string
  direction: "inbound" | "outbound"
  status: "received" | "sent" | "failed"
  // Nullable desde 0015: una ubicación o un sticker no llevan texto.
  text: string | null
  type: MessageType
  content: unknown
  // Null en filas anteriores a 0015; el DTO lo deriva de `direction`.
  origin: MessageOrigin | null
  historical: boolean
  deliveryStatus: DeliveryStatus | null
  replyToProviderMessageId: string | null
  providerMessageId: string | null
  // Opcional porque no toda lectura de `messages` paga el agregado de adjuntos:
  // las rutas de idempotencia saliente devuelven la fila para decidir un replay,
  // no para pintarla. `messageDto` cae a `[]`, que es además lo correcto para
  // las filas anteriores al slice de media.
  attachments?: AttachmentDto[]
  // Informado solo en una respuesta privada a un comentario de Instagram: es lo
  // único que la distingue de un DM normal (migración 0013).
  sourceCommentId: string | null
  error: string | null
  providerResponse: unknown
  idempotencyKey: string | null
  idempotencyFingerprint: string | null
  createdAt: Date
}

export type ConversationRecord = {
  id: string
  tenantId: string
  pageId: string
  contactId: string
  contactName: string | null
  lastMessageAt: Date
}

export type JobRecord = {
  id: string
  eventId: string
  tenantId: string
  // Exactamente uno de los dos va informado (check de la migración 0013): un
  // job entrega un mensaje o un comentario de Instagram, nunca los dos ni
  // ninguno.
  messageId: string | null
  commentId: string | null
  // La cuenta de la que cuelga el job. Sale del join a `connected_pages` que
  // `getJob` ya hacía para el secreto de firma, así que no cuesta una consulta
  // más — y sin ella el log de la entrega solo puede nombrar al tenant, que es
  // justo lo que no alcanza cuando un tenant tiene cuatro cuentas.
  connectionId: string
  channel: Channel
  providerPageId: string
  username: string | null
  webhookUrl: string | null
  payload: unknown
  status: "pending" | "processing" | "succeeded" | "failed_permanent" | "dead"
  attemptCount: number
  recoverAfter: Date
  signingSecretEncrypted: string | null
}

export type OutboundReservation =
  | { kind: "acquired" }
  | { kind: "replay"; message: MessageRecord }
  | { kind: "conflict"; reason: "fingerprint" | "legacy" | "in_progress" }

// Mismas llaves que devuelve `ingestInbound` para que el servicio siga pasando
// el resultado a `enqueueIfPending` sin adaptarlo, pero partido en dos
// variantes: **el historial importado no genera entrega**, así que no hay job
// que encolar. Es una unión y no un puñado de campos nullable porque estrechar
// por `jobId` deja el resto de las llaves ya no-nulas, que es exactamente lo
// que necesita quien encola.
//
// Lo que no se hace es crear el job en `failed_permanent`: sería un fallo
// inventado en la métrica de entregas fallidas, donde solo deberían aparecer
// las que de verdad no se pudieron entregar.
export type WhatsappIngestResult =
  | {
      inserted: boolean
      messageId: string
      jobId: string
      jobStatus: JobRecord["status"]
      jobAttemptCount: number
      jobRecoverAfter: Date
    }
  | {
      inserted: boolean
      messageId: string
      jobId: null
      jobStatus: null
      jobAttemptCount: 0
      jobRecoverAfter: null
    }

// `updated: false` con `messageId` informado es "el status llegó tarde y no
// aplica"; con `messageId` en null es "ese wamid no es de un mensaje nuestro".
// Los dos son normales y ninguno es un error: Meta reintenta statuses y manda
// callbacks de mensajes que pueden no haberse persistido.
export type WhatsappStatusResult = {
  updated: boolean
  messageId: string | null
  deliveryStatus: DeliveryStatus | null
}

export class SqlRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: () => Date = () => new Date()
  ) {}

  async ping(): Promise<boolean> {
    const rows = await this.sql`select 1 as ok`
    return rows[0]?.ok === 1
  }

  async countUnsignedWebhookPages(): Promise<number> {
    const rows = await this.sql`
      select count(*)::int as count
      from connected_pages
      where status = 'active'
        and webhook_url is not null
        and webhook_signing_secret_encrypted is null
    `
    return number(rowValue(rows[0], "count"), 0)
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const rows = await this.sql`
      select id, email, password_hash, waitlisted, created_at
      from users
      where id = ${id}
      limit 1
    `
    return rows[0] ? mapUser(rows[0]) : null
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const rows = await this.sql`
      select id, email, password_hash, waitlisted, created_at
      from users
      where email = ${email}
      limit 1
    `
    return rows[0] ? mapUser(rows[0]) : null
  }

  async createUser(input: {
    email: string
    passwordHash: string
  }): Promise<UserRecord> {
    const rows = await this.sql`
      insert into users (email, password_hash)
      values (${input.email}, ${input.passwordHash})
      returning id, email, password_hash, waitlisted, created_at
    `
    const row = rows[0]
    if (!row) throw new Error("user insert failed")
    return mapUser(row)
  }

  async changePassword(userId: string, passwordHash: string): Promise<boolean> {
    const rows = await this.sql`
      update users
      set password_hash = ${passwordHash}, updated_at = now()
      where id = ${userId}
      returning id
    `
    return Boolean(rows[0])
  }

  async getApiKeyByHash(secretHash: string) {
    const rows = await this.sql`
      select k.id, k.tenant_id, k.secret_hash, k.status, u.waitlisted
      from api_keys k
      join users u on u.id = k.tenant_id
      where k.secret_hash = ${secretHash}
      limit 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: text(row.id),
      tenantId: text(row.tenant_id),
      secretHash: text(row.secret_hash),
      status: text(row.status),
      waitlisted: row.waitlisted === true,
    }
  }

  async touchApiKey(id: string): Promise<boolean> {
    const rows = await this.sql`
      update api_keys
      set last_used_at = now()
      where id = ${id} and status = 'active'
      returning id
    `
    return Boolean(rows[0])
  }

  async listApiKeys(tenantId: string): Promise<ApiKeyDto[]> {
    const rows = await this.sql`
      select id, label, visible_prefix, status, created_at, last_used_at,
        revoked_at
      from api_keys
      where tenant_id = ${tenantId}
      order by created_at desc, id desc
    `
    return rows.map((row) => ({
      id: text(row.id),
      label: text(row.label),
      visiblePrefix: text(row.visible_prefix),
      status: text(row.status) === "revoked" ? "revoked" : "active",
      createdAt: iso(row.created_at),
      lastUsedAt: nullableIso(row.last_used_at),
      revokedAt: nullableIso(row.revoked_at),
    }))
  }

  async createApiKey(input: {
    tenantId: string
    label: string
    visiblePrefix: string
    secretHash: string
  }): Promise<ApiKeyDto> {
    const rows = await this.sql`
      insert into api_keys (tenant_id, label, visible_prefix, secret_hash)
      values (
        ${input.tenantId},
        ${input.label},
        ${input.visiblePrefix},
        ${input.secretHash}
      )
      returning id, label, visible_prefix, status, created_at, last_used_at,
        revoked_at
    `
    const row = rows[0]
    if (!row) throw new Error("api key insert failed")
    return {
      id: text(row.id),
      label: text(row.label),
      visiblePrefix: text(row.visible_prefix),
      status: "active",
      createdAt: iso(row.created_at),
      lastUsedAt: null,
      revokedAt: null,
    }
  }

  async revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean> {
    const rows = await this.sql`
      update api_keys
      set status = 'revoked',
        revoked_at = coalesce(revoked_at, now())
      where tenant_id = ${tenantId} and id = ${apiKeyId}
      returning id
    `
    return Boolean(rows[0])
  }

  async getSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    const rows = await this.sql`
      select tenant_id, stripe_subscription_id, status, price_lookup_key,
        current_period_start, current_period_end, cancel_at_period_end,
        last_stripe_event_at
      from subscriptions
      where tenant_id = ${tenantId}
      limit 1
    `
    return rows[0] ? mapSubscription(rows[0]) : null
  }

  async getUsage(tenantId: string, periodStart: Date): Promise<number> {
    const rows = await this.sql`
      select message_count
      from usage_counters
      where tenant_id = ${tenantId} and period_start = ${periodStart}
      limit 1
    `
    return number(rowValue(rows[0], "message_count"), 0)
  }

  // Cuenta **solo Messenger**. Instagram está fuera del cupo de páginas por
  // ahora, y el filtro va en la consulta porque este número alimenta a la vez el
  // entitlement y la pantalla de selección: si contara las cuentas de Instagram,
  // un tenant se quedaría sin poder conectar Páginas por un cupo que no gastó.
  async countActivePages(tenantId: string): Promise<number> {
    const rows = await this.sql`
      select count(*)::int as count
      from connected_pages
      where tenant_id = ${tenantId}
        and channel = 'messenger'
        and status = 'active'
    `
    return number(rowValue(rows[0], "count"), 0)
  }

  async listPages(
    tenantId: string,
    input: PageListQuery
  ): Promise<{ data: PageDto[]; pagination: PaginationDto }> {
    const cursor = decodeCursor(input.cursor)
    const parameters: unknown[] = [tenantId]
    const clauses = ["tenant_id = $1"]
    if (input.channel) {
      parameters.push(input.channel)
      clauses.push(`channel = $${parameters.length}`)
    }
    if (input.status) {
      parameters.push(input.status)
      clauses.push(`status = $${parameters.length}`)
    }
    if (cursor) {
      parameters.push(cursor.at, cursor.id)
      clauses.push(
        `(updated_at, id) < ($${parameters.length - 1}::timestamptz, $${parameters.length}::uuid)`
      )
    }
    const limit = Math.min(input.limit, API_MAX_LIMIT)
    parameters.push(limit + 1)
    const rows = await this.sql.query(
      `select id, tenant_id, channel, meta_page_id, name, username, status, token_status,
         token_error, webhook_url, page_access_token_encrypted,
         webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
         onboarding_mode, coexistence_status, history_sync_status,
         token_expires_at, connected_at, updated_at
       from connected_pages
       where ${clauses.join(" and ")}
       order by updated_at desc, id desc
       limit $${parameters.length}`,
      parameters
    )
    const hasMore = rows.length > limit
    const selected = rows.slice(0, limit)
    const last = selected.at(-1)
    return {
      data: selected.map((row) => pageDto(mapPage(row))),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                at: iso(last.updated_at),
                id: text(last.id),
              })
            : null,
      },
    }
  }

  async listAllPages(tenantId: string): Promise<PageDto[]> {
    const rows = await this.sql`
      select id, tenant_id, channel, meta_page_id, name, username, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
        onboarding_mode, coexistence_status, history_sync_status,
        token_expires_at, connected_at, updated_at
      from connected_pages
      where tenant_id = ${tenantId}
      order by case when status = 'active' then 0 else 1 end, updated_at desc
    `
    return rows.map((row) => pageDto(mapPage(row)))
  }

  async getPage(tenantId: string, pageId: string): Promise<PageRecord | null> {
    const rows = await this.sql`
      select id, tenant_id, channel, meta_page_id, name, username, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
        onboarding_mode, coexistence_status, history_sync_status,
        token_expires_at, connected_at, updated_at
      from connected_pages
      where tenant_id = ${tenantId} and id = ${pageId}
      limit 1
    `
    return rows[0] ? mapPage(rows[0]) : null
  }

  // El canal es **obligatorio y sin default**. Desde la 0013 `meta_page_id`
  // solo es único dentro de un canal, así que un id de página de Facebook puede
  // coincidir con un IG ID legítimamente. Un default habría convertido «me
  // olvidé de decidir» en «Messenger» sin que nadie lo note, y el evento habría
  // resuelto al tenant equivocado.
  async getActivePageByProviderId(
    providerPageId: string,
    channel: Channel
  ): Promise<PageRecord | null> {
    const rows = await this.sql`
      select id, tenant_id, channel, meta_page_id, name, username, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
        onboarding_mode, coexistence_status, history_sync_status,
        token_expires_at, connected_at, updated_at
      from connected_pages
      where meta_page_id = ${providerPageId}
        and channel = ${channel}
        and status = 'active'
      limit 1
    `
    return rows[0] ? mapPage(rows[0]) : null
  }

  async updatePageWebhook(
    tenantId: string,
    pageId: string,
    webhookUrl: string | null
  ): Promise<PageDto | null> {
    const rows = await this.sql`
      update connected_pages
      set webhook_url = ${webhookUrl}, updated_at = now()
      where tenant_id = ${tenantId} and id = ${pageId}
      returning id, tenant_id, channel, meta_page_id, name, username, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
        onboarding_mode, coexistence_status, history_sync_status,
        token_expires_at, connected_at, updated_at
    `
    return rows[0] ? pageDto(mapPage(rows[0])) : null
  }

  async rotateWebhookSecret(input: {
    tenantId: string
    pageId: string
    encryptedSecret: string
  }): Promise<Date | null> {
    const rows = await this.sql`
      update connected_pages
      set webhook_signing_secret_encrypted = ${input.encryptedSecret},
        webhook_signing_secret_rotated_at = now(),
        updated_at = now()
      where tenant_id = ${input.tenantId} and id = ${input.pageId}
      returning webhook_signing_secret_rotated_at
    `
    return rows[0] ? date(rows[0].webhook_signing_secret_rotated_at) : null
  }

  async disconnectPage(
    tenantId: string,
    pageId: string
  ): Promise<PageDto | null> {
    const rows = await this.sql`
      update connected_pages
      set status = 'disconnected',
        disconnected_at = coalesce(disconnected_at, now()),
        updated_at = now()
      where tenant_id = ${tenantId} and id = ${pageId}
      returning id, tenant_id, channel, meta_page_id, name, username, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
        onboarding_mode, coexistence_status, history_sync_status,
        token_expires_at, connected_at, updated_at
    `
    return rows[0] ? pageDto(mapPage(rows[0])) : null
  }

  async markPageTokenInvalid(input: {
    tenantId: string
    pageId: string
    error: string
  }): Promise<void> {
    await this.sql`
      update connected_pages
      set token_status = 'invalid',
        token_error = ${input.error},
        token_error_at = now(),
        updated_at = now()
      where tenant_id = ${input.tenantId} and id = ${input.pageId}
    `
  }

  async getMetaUserTokenEncrypted(tenantId: string): Promise<string | null> {
    const rows = await this.sql`
      select meta_user_access_token_encrypted
      from users
      where id = ${tenantId}
      limit 1
    `
    return nullableText(rows[0]?.meta_user_access_token_encrypted)
  }

  async saveMetaUserToken(
    tenantId: string,
    encryptedToken: string
  ): Promise<void> {
    await this.sql`
      update users
      set meta_user_access_token_encrypted = ${encryptedToken},
        meta_user_access_token_updated_at = now(),
        updated_at = now()
      where id = ${tenantId}
    `
  }

  // Acotado a Messenger: recibe ids de Página de Facebook, y desde la 0013 una
  // cuenta de Instagram con el mismo id es legítima. Sin el filtro, esa cuenta
  // homónima —de este tenant o de otro— haría que una Página se muestre como
  // «ya pertenece a otra cuenta» por una colisión que no significa nada.
  async getPageOwnership(providerPageIds: string[]) {
    if (providerPageIds.length === 0) return []
    const rows = await this.sql.query(
      `select meta_page_id, tenant_id, status
       from connected_pages
       where channel = 'messenger' and meta_page_id = any($1::text[])`,
      [providerPageIds]
    )
    return rows.map((row) => ({
      providerPageId: text(row.meta_page_id),
      tenantId: text(row.tenant_id),
      status:
        text(row.status) === "disconnected"
          ? ("disconnected" as const)
          : ("active" as const),
    }))
  }

  async connectPages(
    tenantId: string,
    pages: Array<{
      providerPageId: string
      name: string
      encryptedPageToken: string
    }>
  ): Promise<PageDto[]> {
    if (pages.length === 0) return []
    const results = await this.sql.transaction((transaction) =>
      pages.map(
        (page) => transaction`
          insert into connected_pages (
            tenant_id, channel, meta_page_id, name, page_access_token_encrypted
          )
          values (
            ${tenantId},
            'messenger',
            ${page.providerPageId},
            ${page.name},
            ${page.encryptedPageToken}
          )
          -- El conflict target sigue al unique de la tabla, que desde la
          -- migración 0013 es (channel, meta_page_id): los IDs de página de
          -- Facebook y los de cuenta de Instagram viven en namespaces
          -- distintos. Este método es solo de Messenger, de ahí el literal.
          on conflict (channel, meta_page_id) do update set
            name = excluded.name,
            status = 'active',
            token_status = 'valid',
            token_error = null,
            token_error_at = null,
            page_access_token_encrypted = excluded.page_access_token_encrypted,
            connected_at = now(),
            disconnected_at = null,
            updated_at = now()
          where connected_pages.tenant_id = excluded.tenant_id
          returning id, tenant_id, channel, meta_page_id, name, username, status, token_status,
            token_error, webhook_url, page_access_token_encrypted,
            webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
            onboarding_mode, coexistence_status, history_sync_status,
            token_expires_at, connected_at, updated_at
        `
      )
    )
    const rows = results.flat()
    if (rows.length !== pages.length) {
      throw new Error("page ownership changed during connection")
    }
    return rows.map((row) => pageDto(mapPage(row)))
  }

  // Instagram Login autoriza **una** cuenta, así que no hay lista ni
  // transacción: un solo upsert. Igual que `connectPages`, el `where` del
  // `do update` es lo que impide pisar la fila de otro tenant — si el id ya está
  // tomado, el update no aplica, no vuelve fila, y el llamador lo lee como
  // «pertenece a otra cuenta» en vez de robársela en silencio.
  async connectInstagramAccount(input: {
    tenantId: string
    providerAccountId: string
    name: string
    username: string
    encryptedAccessToken: string
    tokenExpiresAt: Date | null
  }): Promise<PageRecord | null> {
    const rows = await this.sql`
      insert into connected_pages (
        tenant_id, channel, meta_page_id, name, username,
        page_access_token_encrypted, token_expires_at
      )
      values (
        ${input.tenantId},
        'instagram',
        ${input.providerAccountId},
        ${input.name},
        ${input.username},
        ${input.encryptedAccessToken},
        ${input.tokenExpiresAt}
      )
      on conflict (channel, meta_page_id) do update set
        name = excluded.name,
        username = excluded.username,
        status = 'active',
        token_status = 'valid',
        token_error = null,
        token_error_at = null,
        page_access_token_encrypted = excluded.page_access_token_encrypted,
        token_expires_at = excluded.token_expires_at,
        connected_at = now(),
        disconnected_at = null,
        updated_at = now()
      where connected_pages.tenant_id = excluded.tenant_id
      returning id, tenant_id, channel, meta_page_id, name, username, status,
        token_status, token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, waba_id, whatsapp_phone_e164,
        onboarding_mode, coexistence_status, history_sync_status,
        token_expires_at, connected_at, updated_at
    `
    return rows[0] ? mapPage(rows[0]) : null
  }

  async listConversations(
    tenantId: string,
    input: ConversationListInput
  ): Promise<{ data: ConversationDto[]; pagination: PaginationDto }> {
    const cursor = decodeCursor(input.cursor)
    const parameters: unknown[] = [tenantId]
    const clauses = ["c.tenant_id = $1"]
    if (input.pageId) {
      parameters.push(input.pageId)
      clauses.push(`c.connected_page_id = $${parameters.length}::uuid`)
    }
    if (input.updatedAfter) {
      parameters.push(input.updatedAfter)
      clauses.push(`c.updated_at > $${parameters.length}::timestamptz`)
    }
    if (cursor) {
      parameters.push(cursor.at, cursor.id)
      clauses.push(
        `(c.last_message_at, c.id) < ($${parameters.length - 1}::timestamptz, $${parameters.length}::uuid)`
      )
    }
    const limit = Math.min(input.limit, API_MAX_LIMIT)
    parameters.push(limit + 1)
    const rows = await this.sql.query(
      `${conversationSelect()}
       where ${clauses.join(" and ")}
       order by c.last_message_at desc, c.id desc
       limit $${parameters.length}`,
      parameters
    )
    const hasMore = rows.length > limit
    const selected = rows.slice(0, limit)
    const last = selected.at(-1)
    return {
      data: selected.map(mapConversationDto),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                at: iso(last.last_message_at),
                id: text(last.id),
              })
            : null,
      },
    }
  }

  async getConversation(
    tenantId: string,
    conversationId: string
  ): Promise<ConversationDto | null> {
    const rows = await this.sql.query(
      `${conversationSelect()}
       where c.tenant_id = $1 and c.id = $2::uuid
       limit 1`,
      [tenantId, conversationId]
    )
    return rows[0] ? mapConversationDto(rows[0]) : null
  }

  async getConversationRecord(
    tenantId: string,
    conversationId: string
  ): Promise<ConversationRecord | null> {
    const rows = await this.sql`
      select id, tenant_id, connected_page_id, contact_id, contact_name,
        last_message_at
      from conversations
      where tenant_id = ${tenantId} and id = ${conversationId}
      limit 1
    `
    return rows[0] ? mapConversation(rows[0]) : null
  }

  async upsertConversation(input: {
    tenantId: string
    pageId: string
    contactId: string
    at: Date
  }): Promise<ConversationRecord> {
    const rows = await this.sql`
      insert into conversations (
        tenant_id, connected_page_id, contact_id, last_message_at
      )
      values (${input.tenantId}, ${input.pageId}, ${input.contactId}, ${input.at})
      on conflict (connected_page_id, contact_id) do update set
        last_message_at = greatest(
          conversations.last_message_at,
          excluded.last_message_at
        ),
        updated_at = now()
      returning id, tenant_id, connected_page_id, contact_id, contact_name,
        last_message_at
    `
    const row = rows[0]
    if (!row) throw new Error("conversation upsert failed")
    return mapConversation(row)
  }

  async listMessages(
    tenantId: string,
    input: MessageListInput
  ): Promise<{ data: MessageDto[]; pagination: PaginationDto }> {
    return this.queryMessages(tenantId, input)
  }

  async listConversationMessages(
    tenantId: string,
    conversationId: string,
    input: { limit: number; cursor?: string }
  ): Promise<{ data: MessageDto[]; pagination: PaginationDto }> {
    return this.queryMessages(tenantId, {
      limit: input.limit,
      cursor: input.cursor,
      conversationId,
    })
  }

  async getMessage(
    tenantId: string,
    messageId: string
  ): Promise<MessageRecord | null> {
    const rows = await this.sql.query(
      `${messageSelect()}
       where messages.tenant_id = $1 and messages.id = $2::uuid
       limit 1`,
      [tenantId, messageId]
    )
    return rows[0] ? mapMessage(rows[0]) : null
  }

  async reserveOutbound(input: {
    tenantId: string
    idempotencyKey: string
    fingerprint: string
  }): Promise<OutboundReservation> {
    const existing = await this.getOutboundByIdempotency(
      input.tenantId,
      input.idempotencyKey
    )
    if (existing) {
      if (!existing.idempotencyFingerprint) {
        return { kind: "conflict", reason: "legacy" }
      }
      return existing.idempotencyFingerprint === input.fingerprint
        ? { kind: "replay", message: existing }
        : { kind: "conflict", reason: "fingerprint" }
    }

    const inserted = await this.sql`
      insert into outbound_idempotency_reservations (
        tenant_id, idempotency_key, fingerprint
      )
      values (${input.tenantId}, ${input.idempotencyKey}, ${input.fingerprint})
      on conflict (tenant_id, idempotency_key) do nothing
      returning tenant_id
    `
    if (inserted[0]) return { kind: "acquired" }

    const reservationRows = await this.sql`
      select fingerprint, state, message_id
      from outbound_idempotency_reservations
      where tenant_id = ${input.tenantId}
        and idempotency_key = ${input.idempotencyKey}
      limit 1
    `
    const reservation = reservationRows[0]
    if (!reservation || text(reservation.fingerprint) !== input.fingerprint) {
      return { kind: "conflict", reason: "fingerprint" }
    }
    const messageId = nullableText(reservation.message_id)
    if (messageId) {
      const message = await this.getMessage(input.tenantId, messageId)
      if (message) return { kind: "replay", message }
    }
    return { kind: "conflict", reason: "in_progress" }
  }

  // La misma proyección que `getMessage` y el listado, y no una recortada: esta
  // lectura es la que contesta el replay de `POST /v1/messages` con una
  // `Idempotency-Key` repetida. Con columnas de menos, el mismo mensaje salía
  // con un DTO distinto según por dónde se pidiera —sin `type`, sin `content`,
  // sin `origin` ni adjuntos en el replay, con todo eso en
  // `GET /v1/messages/{id}`—, que es exactamente lo que la idempotencia promete
  // que no pasa. Cuesta el `left join lateral` de adjuntos sobre una sola fila.
  async getOutboundByIdempotency(
    tenantId: string,
    idempotencyKey: string
  ): Promise<MessageRecord | null> {
    const existingRows = await this.sql.query(
      `${messageSelect()}
       where messages.tenant_id = $1
         and messages.idempotency_key = $2
         and messages.direction = 'outbound'
       limit 1`,
      [tenantId, idempotencyKey]
    )
    return existingRows[0] ? mapMessage(existingRows[0]) : null
  }

  async completeOutbound(input: {
    tenantId: string
    conversationId: string
    pageId: string
    contactId: string
    text: string
    status: "sent" | "failed"
    providerMessageId: string | null
    idempotencyKey: string
    fingerprint: string
    error: string | null
    providerResponse: unknown
    createdAt: Date
    periodStart: Date | null
    // Informado solo por la respuesta privada a un comentario. En un DM normal
    // va null, y esa columna vacía es lo que distingue a los dos.
    sourceCommentId?: string | null
  }): Promise<MessageRecord> {
    const providerResponse = JSON.stringify(input.providerResponse ?? null)
    const rows = await this.sql`
      with inserted as (
        insert into messages (
          tenant_id, conversation_id, connected_page_id, contact_id,
          direction, status, text, meta_message_id,
          instagram_source_comment_id, idempotency_key,
          idempotency_fingerprint, error, provider_response, created_at
        )
        values (
          ${input.tenantId}, ${input.conversationId}, ${input.pageId},
          ${input.contactId}, 'outbound', ${input.status}, ${input.text},
          ${input.providerMessageId}, ${input.sourceCommentId ?? null},
          ${input.idempotencyKey},
          ${input.fingerprint}, ${input.error}, ${providerResponse}::jsonb,
          ${input.createdAt}
        )
        returning id, tenant_id, conversation_id, connected_page_id,
          contact_id, direction, status, text, meta_message_id,
          instagram_source_comment_id, error, provider_response,
          idempotency_key, idempotency_fingerprint, created_at
      ),
      touched_conversation as (
        update conversations
        set last_message_at = greatest(last_message_at, ${input.createdAt}),
          updated_at = now()
        where tenant_id = ${input.tenantId}
          and id = ${input.conversationId}
      ),
      completed_reservation as (
        update outbound_idempotency_reservations
        set state = 'completed',
          message_id = (select id from inserted),
          updated_at = now()
        where tenant_id = ${input.tenantId}
          and idempotency_key = ${input.idempotencyKey}
          and fingerprint = ${input.fingerprint}
      ),
      usage_increment as (
        insert into usage_counters (
          tenant_id, period_start, message_count
        )
        select ${input.tenantId}, ${input.periodStart}, 1
        from inserted
        where ${input.periodStart}::timestamptz is not null
        on conflict (tenant_id, period_start) do update set
          message_count = usage_counters.message_count + 1,
          updated_at = now()
        returning tenant_id
      )
      select * from inserted
    `
    const row = rows[0]
    if (!row) throw new Error("outbound message insert failed")
    return mapMessage(row)
  }

  async ingestInbound(input: {
    page: PageRecord
    contactId: string
    text: string
    providerMessageId: string
    eventId: string
    createdAt: Date
    payloadVersion: number
    periodStart: Date | null
    deliveryEnabled: boolean
    deliveryBlockedReason: string | null
    recoverAfter: Date
  }): Promise<{
    inserted: boolean
    messageId: string
    jobId: string
    jobStatus: JobRecord["status"]
    jobAttemptCount: number
    jobRecoverAfter: Date
  }> {
    const rows = await this.sql`
      with conversation as (
        insert into conversations (
          tenant_id, connected_page_id, contact_id, last_message_at,
          last_inbound_at
        )
        values (
          ${input.page.tenantId}, ${input.page.id}, ${input.contactId},
          ${input.createdAt}, ${input.createdAt}
        )
        on conflict (connected_page_id, contact_id) do update set
          last_message_at = greatest(
            conversations.last_message_at,
            excluded.last_message_at
          ),
          -- Base de la ventana de 24 h (0015): solo un entrante real la mueve,
          -- y un webhook reintentado fuera de orden no la retrocede.
          last_inbound_at = greatest(
            coalesce(conversations.last_inbound_at, excluded.last_inbound_at),
            excluded.last_inbound_at
          ),
          updated_at = now()
        returning id, contact_name
      ),
      inserted_message as (
        insert into messages (
          tenant_id, conversation_id, connected_page_id, contact_id,
          direction, status, text, meta_message_id, created_at
        )
        select
          ${input.page.tenantId}, conversation.id, ${input.page.id},
          ${input.contactId}, 'inbound', 'received', ${input.text},
          ${input.providerMessageId}, ${input.createdAt}
        from conversation
        on conflict (connected_page_id, meta_message_id)
          where meta_message_id is not null and direction = 'inbound'
        do nothing
        returning id, conversation_id
      ),
      inserted_job as (
        insert into external_webhook_jobs (
          event_id, tenant_id, message_id, webhook_url, payload_version,
          payload, status, last_error, recover_after
        )
        select
          ${input.eventId},
          ${input.page.tenantId},
          inserted_message.id,
          ${input.page.webhookUrl},
          ${input.payloadVersion},
          -- REGLA: **todo bind dentro de un jsonb_build_object lleva cast
          -- explícito.** Es la única posición de toda esta base de código donde
          -- Postgres se niega a inferir el tipo de un parámetro, y por eso vale
          -- la pena escribirla una vez acá y referenciarla desde las otras dos
          -- sentencias que arman sobres (comentarios de Instagram y mensajes de
          -- WhatsApp).
          --
          -- El motivo es la declaración de la función: variadic "any". Para un
          -- argumento "any" no hay tipo de destino del que deducir nada. Un
          -- literal sin tipo Postgres lo resuelve a text; un parámetro, no
          -- —tendría que adivinarlo— y aborta al **preparar** la consulta con
          -- "could not determine data type of parameter $N". Al preparar, no al
          -- ejecutar: la sentencia entera muere antes de tocar una sola fila, o
          -- sea que no falla un mensaje raro, falla el canal completo desde el
          -- primer webhook.
          --
          -- Todo lo demás sí se infiere y no necesita cast (comprobado
          -- ejecutándolo, no de memoria): un bind en un insert ... select toma
          -- el tipo de la columna destino incluso a través de un CTE, un
          -- "not $n" se resuelve a boolean, un case con todas las ramas sin
          -- tipo se resuelve a text, y una comparación contra una columna toma
          -- el tipo de la columna.
          --
          -- Un doble de sql **no puede cazar esto**: captura el texto y los
          -- valores, y no infiere tipos. Por eso la red que lo cubre está en
          -- test/postgres/, ejecutando el SQL real contra Postgres (PGlite).
          jsonb_build_object(
            'id', ${input.eventId}::text,
            'type', 'message.received',
            'createdAt', ${input.createdAt.toISOString()}::text,
            'data', jsonb_build_object(
              -- channel y username van también en Messenger (username null
              -- ahí). Un tenant con los dos canales apuntando al mismo webhook
              -- necesita distinguir de cuál vino el mensaje, y una forma
              -- uniforme se consume más fácil que una que cambia según el
              -- canal. Es aditivo, así que no rompe a los consumidores.
              'page', jsonb_build_object(
                'id', ${input.page.id}::text,
                'channel', ${input.page.channel}::text,
                'providerPageId', ${input.page.providerPageId}::text,
                'name', ${input.page.name}::text,
                'username', ${input.page.username}::text
              ),
              'conversation', jsonb_build_object(
                'id', inserted_message.conversation_id,
                'contact', jsonb_build_object(
                  'id', ${input.contactId}::text,
                  'name', (select contact_name from conversation)
                )
              ),
              'message', jsonb_build_object(
                'id', inserted_message.id,
                'direction', 'inbound',
                'status', 'received',
                'type', 'text',
                'text', ${input.text}::text,
                'provider', jsonb_build_object(
                  'name', 'meta',
                  'messageId', ${input.providerMessageId}::text
                ),
                'createdAt', ${input.createdAt.toISOString()}::text
              )
            )
          ),
          case
            when not ${input.deliveryEnabled}::boolean
              or ${input.page.webhookUrl}::text is null
              then 'failed_permanent'
            else 'pending'
          end,
          -- Los casts de estas dos ramas no arreglan nada roto (un not $n es
          -- boolean y un case de puros literales sin tipo es text): fijan el
          -- tipo por escrito para que agregar mañana una rama ya tipada no
          -- cambie en silencio a qué se coacciona el bind de la razón.
          case
            when not ${input.deliveryEnabled}::boolean
              then ${input.deliveryBlockedReason}::text
            when ${input.page.webhookUrl}::text is null
              then 'webhook URL is not configured'
            else null
          end,
          ${input.recoverAfter}
        from inserted_message
        -- Desde 0013 message_id es nullable (un job puede colgar de un
        -- comentario de Instagram) y el unique pasó a ser parcial, así que el
        -- conflict target tiene que repetir el predicado del índice.
        on conflict (message_id) where message_id is not null do nothing
        returning id, message_id, status, attempt_count, recover_after
      ),
      usage_increment as (
        insert into usage_counters (
          tenant_id, period_start, message_count
        )
        select ${input.page.tenantId}, ${input.periodStart}, 1
        from inserted_message
        where ${input.periodStart}::timestamptz is not null
        on conflict (tenant_id, period_start) do update set
          message_count = usage_counters.message_count + 1,
          updated_at = now()
        returning tenant_id
      )
      select
        inserted_message.id as message_id,
        inserted_job.id as job_id,
        inserted_job.status as job_status,
        inserted_job.attempt_count as job_attempt_count,
        inserted_job.recover_after as job_recover_after
      from inserted_message
      join inserted_job on inserted_job.message_id = inserted_message.id
    `
    const row = rows[0]
    if (row) {
      return {
        inserted: true,
        messageId: text(row.message_id),
        jobId: text(row.job_id),
        jobStatus: jobStatus(row.job_status),
        jobAttemptCount: number(row.job_attempt_count, 0),
        jobRecoverAfter: date(row.job_recover_after),
      }
    }

    const existing = await this.sql`
      select m.id as message_id, j.id as job_id, j.status as job_status,
        j.attempt_count as job_attempt_count,
        j.recover_after as job_recover_after
      from messages m
      join external_webhook_jobs j on j.message_id = m.id
      where m.connected_page_id = ${input.page.id}
        and m.meta_message_id = ${input.providerMessageId}
        and m.direction = 'inbound'
      limit 1
    `
    const duplicate = existing[0]
    if (!duplicate) throw new Error("inbound deduplication lookup failed")
    return {
      inserted: false,
      messageId: text(duplicate.message_id),
      jobId: text(duplicate.job_id),
      jobStatus: jobStatus(duplicate.job_status),
      jobAttemptCount: number(duplicate.job_attempt_count, 0),
      jobRecoverAfter: date(duplicate.job_recover_after),
    }
  }

  // Ingesta de un comentario entrante, en una sola sentencia atómica igual que
  // `ingestInbound`: el driver HTTP de Neon no tiene transacciones interactivas,
  // así que insertar el comentario y crear su job de entrega tienen que viajar
  // juntos o el comentario queda persistido y nunca se reenvía.
  //
  // No lleva `usage_increment`: Instagram está fuera de cuota por ahora.
  async ingestInboundComment(input: {
    page: PageRecord
    providerCommentId: string
    parentCommentId: string | null
    mediaId: string
    mediaProductType: string | null
    fromProviderUserId: string
    fromUsername: string | null
    text: string
    eventId: string
    createdAt: Date
    payloadVersion: number
    deliveryEnabled: boolean
    deliveryBlockedReason: string | null
    recoverAfter: Date
  }): Promise<{
    inserted: boolean
    commentId: string
    jobId: string
    jobStatus: JobRecord["status"]
    jobAttemptCount: number
  }> {
    const rows = await this.sql`
      with inserted_comment as (
        insert into instagram_comments (
          tenant_id, connected_page_id, ig_comment_id, parent_ig_comment_id,
          media_id, media_product_type, from_ig_id, from_username,
          direction, status, text, created_at
        )
        values (
          ${input.page.tenantId}, ${input.page.id}, ${input.providerCommentId},
          ${input.parentCommentId}, ${input.mediaId}, ${input.mediaProductType},
          ${input.fromProviderUserId}, ${input.fromUsername},
          'inbound', 'received', ${input.text}, ${input.createdAt}
        )
        on conflict (connected_page_id, ig_comment_id)
          where ig_comment_id is not null and direction = 'inbound'
        do nothing
        returning id
      ),
      inserted_job as (
        insert into external_webhook_jobs (
          event_id, tenant_id, instagram_comment_id, webhook_url,
          payload_version, payload, status, last_error, recover_after
        )
        select
          ${input.eventId},
          ${input.page.tenantId},
          inserted_comment.id,
          ${input.page.webhookUrl},
          ${input.payloadVersion},
          -- Cast obligatorio en cada bind: ver la regla completa en el sobre de
          -- ingestInbound. jsonb_build_object es variadic "any" y un parámetro
          -- sin cast rompe la sentencia entera al preparar.
          jsonb_build_object(
            'id', ${input.eventId}::text,
            'type', 'comment.received',
            'createdAt', ${input.createdAt.toISOString()}::text,
            'data', jsonb_build_object(
              'page', jsonb_build_object(
                'id', ${input.page.id}::text,
                'channel', ${input.page.channel}::text,
                'providerPageId', ${input.page.providerPageId}::text,
                'name', ${input.page.name}::text,
                'username', ${input.page.username}::text
              ),
              'comment', jsonb_build_object(
                'id', inserted_comment.id,
                'providerCommentId', ${input.providerCommentId}::text,
                'parentCommentId', ${input.parentCommentId}::text,
                'mediaId', ${input.mediaId}::text,
                'mediaProductType', ${input.mediaProductType}::text,
                'from', jsonb_build_object(
                  'providerUserId', ${input.fromProviderUserId}::text,
                  'username', ${input.fromUsername}::text
                ),
                'direction', 'inbound',
                'status', 'received',
                'text', ${input.text}::text,
                'createdAt', ${input.createdAt.toISOString()}::text
              )
            )
          ),
          case
            when not ${input.deliveryEnabled}::boolean
              or ${input.page.webhookUrl}::text is null
              then 'failed_permanent'
            else 'pending'
          end,
          case
            when not ${input.deliveryEnabled}::boolean
              then ${input.deliveryBlockedReason}::text
            when ${input.page.webhookUrl}::text is null
              then 'webhook URL is not configured'
            else null
          end,
          ${input.recoverAfter}
        from inserted_comment
        on conflict (instagram_comment_id)
          where instagram_comment_id is not null
        do nothing
        returning id, instagram_comment_id, status, attempt_count
      )
      select
        inserted_comment.id as comment_id,
        inserted_job.id as job_id,
        inserted_job.status as job_status,
        inserted_job.attempt_count as job_attempt_count
      from inserted_comment
      join inserted_job on inserted_job.instagram_comment_id = inserted_comment.id
    `
    const row = rows[0]
    if (row) {
      return {
        inserted: true,
        commentId: text(row.comment_id),
        jobId: text(row.job_id),
        jobStatus: jobStatus(row.job_status),
        jobAttemptCount: number(row.job_attempt_count, 0),
      }
    }

    // El `do nothing` no devolvió fila: Meta reintentó el mismo webhook o dos
    // requests corrieron a la par. Se relee para poder decir cuál es el job,
    // aunque no se vaya a reenviar.
    const existing = await this.sql`
      select c.id as comment_id, j.id as job_id, j.status as job_status,
        j.attempt_count as job_attempt_count
      from instagram_comments c
      join external_webhook_jobs j on j.instagram_comment_id = c.id
      where c.connected_page_id = ${input.page.id}
        and c.ig_comment_id = ${input.providerCommentId}
        and c.direction = 'inbound'
      limit 1
    `
    const duplicate = existing[0]
    if (!duplicate) throw new Error("comment deduplication lookup failed")
    return {
      inserted: false,
      commentId: text(duplicate.comment_id),
      jobId: text(duplicate.job_id),
      jobStatus: jobStatus(duplicate.job_status),
      jobAttemptCount: number(duplicate.job_attempt_count, 0),
    }
  }

  // Ingesta de un mensaje de WhatsApp en una sola sentencia atómica, hermana de
  // `ingestInbound` y separada de ella a propósito: aquélla es la ruta caliente
  // de Messenger e Instagram y este canal mete demasiadas piezas nuevas
  // —adjuntos, historia que no se reenvía, dos índices de dedupe— como para
  // colarlas ahí detrás de banderas.
  //
  // Los tres orígenes de la 0015 entran por acá con la misma forma
  // (`WhatsappMessageEvent`): entrante en vivo, echo de la WhatsApp Business App
  // e importado del historial. Lo que cambia entre ellos son datos, no ramas.
  async ingestWhatsappInbound(input: {
    page: PageRecord
    event: WhatsappMessageEvent
    eventId: string
    payloadVersion: number
    periodStart: Date | null
    deliveryEnabled: boolean
    deliveryBlockedReason: string | null
    recoverAfter: Date
  }): Promise<WhatsappIngestResult> {
    const event = input.event
    // La ventana de atención de 24 h la abre **solo un entrante que escribió una
    // persona**. Son tres exclusiones y ninguna es redundante:
    //
    //   - saliente: la ventana la abre el cliente, no el negocio;
    //   - historial importado: describe una conversación de hace meses, y
    //     tomarlo como entrante abriría una ventana falsa;
    //   - `origin: "system"`: `user_changed_number` y compañía los genera
    //     WhatsApp, no el contacto. El parser ya se toma el trabajo de marcarlos
    //     para no meterlos en la conversación como si el contacto hubiera
    //     hablado, y abrir 24 h de mensajería libre con ellos es la misma
    //     mentira contada más caro: Meta no reconoce esa ventana y el primer
    //     envío vuelve con un 131047.
    //
    // Se resuelve acá y viaja como un bind ya decidido —null cuando no aplica—
    // porque `greatest` ignora los nulls, y eso deja una sola expresión en el
    // `on conflict` para los tres orígenes.
    const lastInboundAt =
      event.direction === "inbound" &&
      !event.historical &&
      event.origin !== "system"
        ? event.createdAt
        : null
    // `status` interno (received|sent|failed) no es `delivery_status` de Meta:
    // acá solo se dice de qué lado salió el mensaje, y el detalle de la entrega
    // —incluido un `failed`— vive en la otra columna.
    const status = event.direction === "inbound" ? "received" : "sent"
    const content = event.content ? JSON.stringify(event.content) : null
    const failure = formatWhatsappErrors(event.errors)
    // Los adjuntos viajan como un solo jsonb y se expanden con
    // `jsonb_to_recordset`: N adjuntos siguen siendo una sentencia, y el número
    // de binds no depende del payload de Meta.
    const attachments = JSON.stringify(
      event.attachments.map((attachment) => ({
        kind: attachment.kind,
        provider_media_id: attachment.providerMediaId,
        mime_type: attachment.mimeType ?? UNKNOWN_MEDIA_MIME_TYPE,
        filename: attachment.filename,
        caption: attachment.caption,
        sha256: attachment.sha256,
      }))
    )

    const rows = await this.sql`
      with conversation as (
        insert into conversations (
          tenant_id, connected_page_id, contact_id, contact_name,
          last_message_at, last_inbound_at
        )
        values (
          ${input.page.tenantId}, ${input.page.id}, ${event.contactId},
          ${event.contactName}, ${event.createdAt},
          -- ventana de 24 h: informada solo por un entrante real (ver arriba)
          ${lastInboundAt}
        )
        on conflict (connected_page_id, contact_id) do update set
          last_message_at = greatest(
            conversations.last_message_at,
            excluded.last_message_at
          ),
          -- greatest ignora los nulls, así que un histórico o un echo (que
          -- llegan con excluded.last_inbound_at en null) dejan la ventana
          -- donde estaba, y un entrante reintentado fuera de orden no la
          -- retrocede. Toda la regla está en el bind de arriba.
          last_inbound_at = greatest(
            conversations.last_inbound_at,
            excluded.last_inbound_at
          ),
          -- El nombre del perfil solo rellena el hueco: el que manda es el de
          -- la libreta del negocio (smb_app_state_sync), y sobrescribirlo en
          -- cada mensaje lo haría oscilar entre dos fuentes distintas.
          contact_name = coalesce(
            conversations.contact_name,
            excluded.contact_name
          ),
          updated_at = now()
        returning id, contact_name
      ),
      inserted_message as (
        insert into messages (
          tenant_id, conversation_id, connected_page_id, contact_id,
          direction, status, message_type, text, content, origin, historical,
          delivery_status, reply_to_meta_message_id, meta_message_id, error,
          created_at
        )
        select
          ${input.page.tenantId}, conversation.id, ${input.page.id},
          ${event.contactId}, ${event.direction}, ${status}, ${event.type},
          ${event.text}, ${content}::jsonb, ${event.origin},
          ${event.historical}::boolean, ${event.deliveryStatus},
          ${event.replyToProviderMessageId}, ${event.providerMessageId},
          ${failure}, ${event.createdAt}
        from conversation
        -- **Sin conflict target, y no por comodidad.** El dedupe de este canal
        -- vive en dos índices parciales excluyentes —el de 0001 exige
        -- direction = 'inbound' y el de 0015 direction = 'outbound' and
        -- origin in ('business_app','history')— y Postgres obliga a repetir
        -- literalmente el predicado del índice que se quiere usar. Ese
        -- predicado depende de la fila que se está insertando, y un bind no
        -- sirve: la implicación se prueba con constantes, no con parámetros.
        -- Sin target, Postgres elige el índice que corresponda a cada fila.
        --
        -- messages no tiene más unique que esos dos y su clave primaria
        -- generada, así que esto no puede tragarse otra cosa; y si algún día
        -- pudiera, la relectura de abajo no encontraría el duplicado y la
        -- ingesta fallaría ruidosamente en vez de perder el mensaje.
        on conflict do nothing
        returning id, conversation_id
      ),
      inserted_attachments as (
        insert into message_attachments (
          tenant_id, message_id, kind, provider_media_id, mime_type, filename,
          caption, sha256, status
        )
        select
          ${input.page.tenantId}, inserted_message.id, attachment.kind,
          attachment.provider_media_id, attachment.mime_type,
          attachment.filename, attachment.caption, attachment.sha256,
          -- Nace 'pending' y sin bytes: el webhook contesta 200 sin una sola
          -- llamada a Meta, y la descarga la hace la cola con reintentos.
          'pending'
        from inserted_message
        cross join jsonb_to_recordset(${attachments}::jsonb) as attachment(
          kind text,
          provider_media_id text,
          mime_type text,
          filename text,
          caption text,
          sha256 text
        )
        returning id, kind, mime_type, filename, caption, size_bytes, sha256,
          status
      ),
      inserted_media_jobs as (
        insert into whatsapp_media_jobs (tenant_id, attachment_id)
        select ${input.page.tenantId}, inserted_attachments.id
        from inserted_attachments
        -- unique (attachment_id) (0015): un reintento no descarga dos veces
        -- ni deja dos objetos en R2.
        on conflict (attachment_id) do nothing
        returning id
      ),
      inserted_job as (
        insert into external_webhook_jobs (
          event_id, tenant_id, message_id, webhook_url, payload_version,
          payload, status, last_error, recover_after
        )
        select
          ${input.eventId},
          ${input.page.tenantId},
          inserted_message.id,
          ${input.page.webhookUrl},
          ${input.payloadVersion},
          -- **Este sobre es el que rompió el canal en producción**: el bind del
          -- eventId de acá abajo era el $29 del "could not determine data type
          -- of parameter $29" que devolvía 500 a todo webhook entrante de
          -- WhatsApp. Cast obligatorio en cada bind; la regla completa está
          -- escrita en el sobre de ingestInbound.
          --
          -- Y el cast no es solo tipado: **elige la forma del JSON**. ::text
          -- produce "false" donde ::boolean produce false, así que cada uno de
          -- abajo es el tipo que el contrato público promete para esa llave
          -- (historical es booleano, content es un objeto, el resto texto).
          jsonb_build_object(
            'id', ${input.eventId}::text,
            'type', 'message.received',
            'createdAt', ${event.createdAt.toISOString()}::text,
            'data', jsonb_build_object(
              -- El sobre no cambia: hay consumidores contra {page,
              -- conversation, message} y lo nuevo entra como llaves
              -- adicionales, que ningún cliente razonable rompe.
              'page', jsonb_build_object(
                'id', ${input.page.id}::text,
                'channel', ${input.page.channel}::text,
                'providerPageId', ${input.page.providerPageId}::text,
                'name', ${input.page.name}::text,
                'username', ${input.page.username}::text,
                -- Identidad propia de WhatsApp. phoneNumberId repite
                -- providerPageId porque para este canal son el mismo dato
                -- (0015 reusa meta_page_id para el phone_number_id), pero el
                -- consumidor no tiene por qué saberlo: con el nombre del canal
                -- delante, la integración se escribe sin adivinar.
                'wabaId', ${input.page.wabaId}::text,
                'phoneNumberId', ${input.page.providerPageId}::text,
                'onboardingMode', ${input.page.onboardingMode}::text
              ),
              'conversation', jsonb_build_object(
                'id', inserted_message.conversation_id,
                'contact', jsonb_build_object(
                  'id', ${event.contactId}::text,
                  'name', (select contact_name from conversation)
                )
              ),
              'message', jsonb_build_object(
                'id', inserted_message.id,
                'direction', ${event.direction}::text,
                'status', ${status}::text,
                'type', ${event.type}::text,
                'text', ${event.text}::text,
                -- Sin content una ubicación llegaría sin coordenadas y un
                -- order sin importe: text es null en todos los tipos que no
                -- llevan texto propio.
                'content', ${content}::jsonb,
                'attachments', coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', attachment.id,
                        'kind', attachment.kind,
                        'mimeType', attachment.mime_type,
                        'filename', attachment.filename,
                        'caption', attachment.caption,
                        'sizeBytes', attachment.size_bytes,
                        'sha256', attachment.sha256,
                        'status', attachment.status,
                        -- Todavía no hay bytes que ofrecer; el endpoint de
                        -- descarga lo informará cuando el adjunto esté
                        -- 'available'.
                        'downloadUrl', null
                      )
                      order by attachment.id
                    )
                    from inserted_attachments attachment
                  ),
                  '[]'::jsonb
                ),
                'origin', ${event.origin}::text,
                'historical', ${event.historical}::boolean,
                'deliveryStatus', ${event.deliveryStatus}::text,
                'replyTo', case
                  when ${event.replyToProviderMessageId}::text is null then null
                  else jsonb_build_object(
                    'providerMessageId', ${event.replyToProviderMessageId}::text
                  )
                end,
                'provider', jsonb_build_object(
                  'name', 'meta',
                  'messageId', ${event.providerMessageId}::text
                ),
                'createdAt', ${event.createdAt.toISOString()}::text
              )
            )
          ),
          case
            when not ${input.deliveryEnabled}::boolean
              or ${input.page.webhookUrl}::text is null
              then 'failed_permanent'
            else 'pending'
          end,
          -- Mismos casts defensivos que en ingestInbound: acá no arreglan nada
          -- roto, dejan el tipo por escrito.
          case
            when not ${input.deliveryEnabled}::boolean
              then ${input.deliveryBlockedReason}::text
            when ${input.page.webhookUrl}::text is null
              then 'webhook URL is not configured'
            else null
          end,
          ${input.recoverAfter}
        from inserted_message
        -- entrega externa: el historial no la genera. Reenviar seis meses de
        -- conversaciones dispararía las automatizaciones del tenant sobre
        -- hechos viejos, que es justo lo que la sync de Coexistence no debe
        -- provocar.
        where not ${event.historical}::boolean
        on conflict (message_id) where message_id is not null do nothing
        returning id, message_id, status, attempt_count, recover_after
      ),
      usage_increment as (
        insert into usage_counters (
          tenant_id, period_start, message_count
        )
        select ${input.page.tenantId}, ${input.periodStart}, 1
        from inserted_message
        -- Importar el historial no es consumo: son mensajes que ya ocurrieron
        -- antes de conectar el número, y cobrarlos vaciaría la cuota del plan
        -- en el primer minuto del onboarding.
        where ${input.periodStart}::timestamptz is not null
          and not ${event.historical}::boolean
        on conflict (tenant_id, period_start) do update set
          message_count = usage_counters.message_count + 1,
          updated_at = now()
        returning tenant_id
      )
      select
        inserted_message.id as message_id,
        inserted_job.id as job_id,
        inserted_job.status as job_status,
        inserted_job.attempt_count as job_attempt_count,
        inserted_job.recover_after as job_recover_after
      from inserted_message
      -- left, al contrario que en ingestInbound: un histórico se persiste
      -- sin job y con un join interno el mensaje volvería como si no se hubiera
      -- insertado.
      left join inserted_job on inserted_job.message_id = inserted_message.id
    `
    const row = rows[0]
    if (row) return whatsappIngestResult(true, row)

    // Sin fila: el wamid ya estaba. Meta reintenta el mismo webhook y en
    // Coexistence el mismo mensaje puede llegar dos veces por caminos distintos
    // (echo y luego historial). Se relee para poder contestar con el id que ya
    // existe.
    //
    // Se acota por `direction` y no por `origin`: los dos índices parciales se
    // reparten por dirección, y un echo que choca contra una fila importada del
    // historial es el mismo mensaje aunque el origen difiera.
    //
    // Y lleva `order by` porque un `limit 1` sin él devuelve una fila
    // arbitraria, y acá puede haber dos: los uniques parciales **no** cubren
    // `origin = 'resender_api'`, así que en cuanto exista el pipeline de envío
    // un mensaje que mandemos por la API y su echo de Coexistence convivirán
    // como dos filas salientes con el mismo `wamid`. Devolver la equivocada
    // haría que el servicio reportara un `messageId` que no es y se saltara el
    // encolado.
    //
    // El criterio es el origen del propio evento: la fila que provocó el
    // conflicto es la única que el llamador puede reconocer como suya. Se
    // compara con `is not distinct from` y no con `=` porque una fila anterior a
    // la 0015 tiene `origin` en null, y `null = 'business_app'` da null, que en
    // un `desc` ordena **primero**.
    //
    // El desempate es la fila más antigua, con `id` detrás para que el orden sea
    // total: cuando el origen no distingue —un echo que choca contra una fila
    // importada del historial es el mismo mensaje—, lo que importa es que Meta,
    // que reintenta el mismo webhook varias veces, reciba siempre el mismo id.
    const existing = await this.sql`
      select m.id as message_id, j.id as job_id, j.status as job_status,
        j.attempt_count as job_attempt_count,
        j.recover_after as job_recover_after
      from messages m
      left join external_webhook_jobs j on j.message_id = m.id
      where m.connected_page_id = ${input.page.id}
        and m.meta_message_id = ${event.providerMessageId}
        and m.direction = ${event.direction}
      -- orden determinista, explicado arriba: primero la fila del evento que se
      -- está ingiriendo y, si el origen no la distingue, la más antigua.
      order by (m.origin is not distinct from ${event.origin}) desc,
        m.created_at asc, m.id asc
      limit 1
    `
    const duplicate = existing[0]
    if (!duplicate) throw new Error("whatsapp deduplication lookup failed")
    return whatsappIngestResult(false, duplicate)
  }

  // Estado de entrega que reporta Meta, aplicado **monotónicamente**: los
  // callbacks de Cloud API no llegan ordenados y un `sent` rezagado no puede
  // borrar el hecho de que el mensaje ya se leyó.
  //
  // La comparación y la escritura son la misma sentencia a propósito: leer el
  // estado, decidir en TypeScript y escribir después deja una ventana en la que
  // dos callbacks concurrentes se pisan, y el perdedor sería el más nuevo la
  // mitad de las veces.
  //
  // El `limit 1` del CTE `target` lleva `order by` por el mismo motivo que la
  // relectura de la ingesta: dos filas pueden compartir `wamid` —lo que
  // enviemos por la API y su echo de Coexistence, que los uniques parciales no
  // cruzan—. Acá la que el llamador quiere es la que el tenant ve por la API, la
  // que nació de su `POST /v1/messages`, porque es la que después lee por
  // `GET /v1/messages/{id}`: escribir el estado en el echo dejaría su mensaje
  // congelado en el estado con el que se creó. `is not distinct from` por lo
  // mismo que allá: `origin` es null en las filas anteriores a la 0015.
  async applyWhatsappStatus(input: {
    page: PageRecord
    event: WhatsappStatusEvent
  }): Promise<WhatsappStatusResult> {
    const failure = formatWhatsappErrors(input.event.errors)
    const rows = await this.sql`
      with target as (
        select id, delivery_status
        from messages
        where connected_page_id = ${input.page.id}
          -- Sin filtro por direction: hoy Meta solo emite statuses de lo que
          -- mandamos nosotros, pero el wamid ya identifica la fila y un
          -- deleted futuro sobre un entrante no tendría por qué perderse.
          and meta_message_id = ${input.event.providerMessageId}
        -- orden determinista, explicado arriba: la fila que el tenant envió por
        -- la API antes que su echo, y la más antigua como desempate.
        order by (origin is not distinct from 'resender_api') desc,
          created_at asc, id asc
        limit 1
      ),
      applied as (
        update messages
        set delivery_status = ${input.event.deliveryStatus},
          -- El error solo se escribe cuando el status trae uno: un delivered
          -- posterior no borra el diagnóstico del intento que falló.
          error = coalesce(${failure}::text, messages.error)
        where messages.id = (select id from target)
          -- rank de estados: 'accepted' < 'sent' < 'delivered' < 'read', y
          -- 'failed'/'deleted' por encima porque son terminales — un fallo no
          -- puede quedar tapado por un delivered que venía en vuelo. El
          -- estado desconocido o ausente vale 0, así que el primer callback
          -- siempre entra.
          --
          -- Se compara contra messages.delivery_status y no contra la copia
          -- del CTE: si dos callbacks concurrentes tocan la fila, el segundo
          -- revalida esta condición contra la versión ya escrita.
          and coalesce(
            array_position(
              array[
                'accepted', 'sent', 'delivered', 'read', 'failed', 'deleted'
              ]::text[],
              ${input.event.deliveryStatus}::text
            ),
            0
          ) > coalesce(
            array_position(
              array[
                'accepted', 'sent', 'delivered', 'read', 'failed', 'deleted'
              ]::text[],
              messages.delivery_status
            ),
            0
          )
        returning messages.id, messages.delivery_status
      )
      select
        target.id as message_id,
        target.delivery_status as current_status,
        (select delivery_status from applied) as applied_status
      from target
    `
    const row = rows[0]
    // Un wamid que no es nuestro no es un error: Meta manda statuses de
    // mensajes que este tenant nunca persistió (envíos desde otra herramienta
    // sobre el mismo número en Coexistence).
    if (!row) return { updated: false, messageId: null, deliveryStatus: null }
    const applied = deliveryStatus(row.applied_status)
    return {
      updated: applied !== null,
      messageId: text(row.message_id),
      deliveryStatus: applied ?? deliveryStatus(row.current_status),
    }
  }

  // `smb_app_state_sync`: la libreta de contactos del negocio, que en
  // Coexistence es la única fuente del nombre con el que el negocio conoce a su
  // cliente (el perfil de WhatsApp trae el que el cliente se puso a sí mismo).
  //
  // **Un `add` es un upsert del nombre, no un insert**: Meta manda las
  // ediciones de contacto como `add`, y la segunda edición del mismo teléfono
  // reventaría un insert a secas.
  //
  // Lo que no hace es crear la conversación cuando no existe. El sync trae la
  // agenda entera del teléfono, no solo a quien escribió: materializarla serían
  // cientos de hilos vacíos en Inbox el día del onboarding.
  async applyWhatsappContactSync(input: {
    page: PageRecord
    event: WhatsappContactSyncEvent
  }): Promise<{ updated: boolean }> {
    const rows = await this.sql`
      update conversations
      set contact_name = case
          -- Un remove es "lo borré de mi agenda", no "borrá la conversación":
          -- el historial y el hilo se conservan y solo se olvida el nombre, que
          -- es el único dato que el negocio pidió quitar.
          when ${input.event.action === "remove"}::boolean then null
          else coalesce(${input.event.fullName}::text, contact_name)
        end,
        -- Sella el intento igual que la resolución por Graph de la 0014, para
        -- que nada vuelva a pedir un nombre que WhatsApp ya nos dio.
        contact_synced_at = now(),
        updated_at = now()
      where tenant_id = ${input.page.tenantId}
        and connected_page_id = ${input.page.id}
        -- La documentación de Meta se contradice sobre el + y wa_id puede
        -- no coincidir con from, así que la identidad se compara por dígitos.
        -- No usa índice, pero el filtro por cuenta ya acota el recorrido a las
        -- conversaciones de un número.
        and regexp_replace(contact_id, '[^0-9]', '', 'g') = ${digitsOf(
          input.event.phoneNumber
        )}
      returning id
    `
    return { updated: rows.length > 0 }
  }

  // **Tercera señal anti-bucle.** Las otras dos leen el `from` que manda Meta;
  // esta pregunta si el id del comentario es de una fila que escribimos
  // nosotros, que es un hecho propio y no una interpretación de su payload.
  async isOwnPublishedComment(input: {
    pageId: string
    providerCommentId: string
  }): Promise<boolean> {
    const rows = await this.sql`
      select id from instagram_comments
      where connected_page_id = ${input.pageId}
        and ig_comment_id = ${input.providerCommentId}
        and direction = 'outbound'
      limit 1
    `
    return Boolean(rows[0])
  }

  async getComment(
    tenantId: string,
    commentId: string
  ): Promise<CommentRecord | null> {
    const rows = await this.sql`
      select id, tenant_id, connected_page_id, ig_comment_id,
        parent_ig_comment_id, media_id, media_product_type, from_ig_id,
        from_username, direction, status, text, error, idempotency_key,
        created_at
      from instagram_comments
      where tenant_id = ${tenantId} and id = ${commentId}
      limit 1
    `
    return rows[0] ? mapComment(rows[0]) : null
  }

  async listComments(
    tenantId: string,
    input: CommentListInput
  ): Promise<{ data: CommentDto[]; pagination: PaginationDto }> {
    const cursor = decodeCursor(input.cursor)
    const parameters: unknown[] = [tenantId]
    const clauses = ["tenant_id = $1"]
    if (input.pageId) {
      parameters.push(input.pageId)
      clauses.push(`connected_page_id = $${parameters.length}::uuid`)
    }
    if (input.mediaId) {
      parameters.push(input.mediaId)
      clauses.push(`media_id = $${parameters.length}`)
    }
    if (input.direction) {
      parameters.push(input.direction)
      clauses.push(`direction = $${parameters.length}`)
    }
    if (cursor) {
      parameters.push(cursor.at, cursor.id)
      clauses.push(
        `(created_at, id) < ($${parameters.length - 1}::timestamptz, $${parameters.length}::uuid)`
      )
    }
    const limit = Math.min(input.limit, API_MAX_LIMIT)
    parameters.push(limit + 1)
    const rows = await this.sql.query(
      `select id, tenant_id, connected_page_id, ig_comment_id,
         parent_ig_comment_id, media_id, media_product_type, from_ig_id,
         from_username, direction, status, text, error, idempotency_key,
         created_at
       from instagram_comments
       where ${clauses.join(" and ")}
       order by created_at desc, id desc
       limit $${parameters.length}`,
      parameters
    )
    const hasMore = rows.length > limit
    const selected = rows.slice(0, limit)
    const last = selected.at(-1)
    return {
      data: selected.map((row) => commentDto(mapComment(row))),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ at: iso(last.created_at), id: text(last.id) })
            : null,
      },
    }
  }

  // Persiste la respuesta pública, la haya aceptado Meta o no: el rechazo es
  // justamente lo que el usuario necesita ver en el log. Si falló no hay
  // `ig_comment_id` porque no se publicó nada, y la columna es nullable
  // precisamente para eso.
  async insertOutboundComment(input: {
    tenantId: string
    pageId: string
    providerCommentId: string | null
    parentCommentId: string
    mediaId: string
    mediaProductType: string | null
    fromProviderUserId: string
    fromUsername: string | null
    status: "sent" | "failed"
    text: string
    idempotencyKey: string
    error: string | null
    providerResponse: unknown
    createdAt: Date
  }): Promise<CommentRecord> {
    const providerResponse = JSON.stringify(input.providerResponse ?? null)
    const rows = await this.sql`
      insert into instagram_comments (
        tenant_id, connected_page_id, ig_comment_id, parent_ig_comment_id,
        media_id, media_product_type, from_ig_id, from_username, direction,
        status, text, idempotency_key, error, provider_response, created_at
      )
      values (
        ${input.tenantId}, ${input.pageId}, ${input.providerCommentId},
        ${input.parentCommentId}, ${input.mediaId}, ${input.mediaProductType},
        ${input.fromProviderUserId}, ${input.fromUsername}, 'outbound',
        ${input.status}, ${input.text}, ${input.idempotencyKey}, ${input.error},
        ${providerResponse}::jsonb, ${input.createdAt}
      )
      returning id, tenant_id, connected_page_id, ig_comment_id,
        parent_ig_comment_id, media_id, media_product_type, from_ig_id,
        from_username, direction, status, text, error, idempotency_key,
        created_at
    `
    const row = rows[0]
    if (!row) throw new Error("outbound comment insert failed")
    return mapComment(row)
  }

  async getOutboundCommentByIdempotency(
    tenantId: string,
    idempotencyKey: string
  ): Promise<CommentRecord | null> {
    const rows = await this.sql`
      select id, tenant_id, connected_page_id, ig_comment_id,
        parent_ig_comment_id, media_id, media_product_type, from_ig_id,
        from_username, direction, status, text, error, idempotency_key,
        created_at
      from instagram_comments
      where tenant_id = ${tenantId}
        and idempotency_key = ${idempotencyKey}
        and direction = 'outbound'
      limit 1
    `
    return rows[0] ? mapComment(rows[0]) : null
  }

  // Instagram permite **una sola** respuesta privada por comentario, y la
  // rechaza con un 100/2534025 que junta cuatro causas distintas. Esta lectura
  // convierte ese caso ambiguo en un 409 que dice exactamente qué pasó.
  //
  // Solo cuenta el envío que Meta aceptó: un intento fallido no consumió la
  // única respuesta disponible y tiene que poder reintentarse.
  //
  // Proyecta lo mismo que el resto por la misma razón que
  // `getOutboundByIdempotency`: hoy el llamador solo lee `.id` para el detalle
  // del 409, pero lo que devuelve es un `MessageRecord` como cualquier otro, y
  // un `MessageRecord` al que le faltan columnas miente en silencio —`type`
  // colapsa a 'text', `origin` a null y los adjuntos a []— en cuanto alguien lo
  // pase por `messageDto`. Una fila, un join lateral: no hay coste que defienda
  // la proyección recortada.
  async getPrivateReplyForComment(input: {
    tenantId: string
    providerCommentId: string
  }): Promise<MessageRecord | null> {
    const rows = await this.sql.query(
      `${messageSelect()}
       where messages.tenant_id = $1
         and messages.instagram_source_comment_id = $2
         and messages.direction = 'outbound'
         and messages.status = 'sent'
       limit 1`,
      [input.tenantId, input.providerCommentId]
    )
    return rows[0] ? mapMessage(rows[0]) : null
  }

  async claimJob(
    jobId: string,
    processingTimeoutSeconds: number
  ): Promise<JobRecord | null> {
    const recoverAfter = new Date(
      this.now().getTime() + processingTimeoutSeconds * 1000
    )
    const claimed = await this.sql`
      update external_webhook_jobs
      set status = 'processing',
        attempt_count = attempt_count + 1,
        recover_after = ${recoverAfter},
        updated_at = now()
      where id = ${jobId} and status = 'pending'
      returning id
    `
    if (!claimed[0]) return null
    return this.getJob(jobId)
  }

  // Desde la 0013 un job cuelga de un mensaje **o** de un comentario de
  // Instagram, con un check de que sea exactamente uno. Los dos joins son
  // `left` y la cuenta se resuelve del que haya venido informado: con el join
  // interno de antes, un job de comentario no devolvía fila y la entrega quedaba
  // colgada sin explicación.
  async getJob(jobId: string): Promise<JobRecord | null> {
    const rows = await this.sql`
      select j.id, j.event_id, j.tenant_id, j.message_id,
        j.instagram_comment_id, j.webhook_url, j.payload, j.status,
        j.attempt_count, j.recover_after,
        p.id as connected_page_id, p.channel, p.meta_page_id, p.username,
        p.webhook_signing_secret_encrypted
      from external_webhook_jobs j
      left join messages m on m.id = j.message_id
      left join instagram_comments c on c.id = j.instagram_comment_id
      join connected_pages p
        on p.id = coalesce(m.connected_page_id, c.connected_page_id)
      where j.id = ${jobId}
      limit 1
    `
    return rows[0] ? mapJob(rows[0]) : null
  }

  async recordJobAttempt(input: {
    job: JobRecord
    outcome: "succeeded" | "pending" | "failed_permanent"
    statusCode: number | null
    error: string | null
    retryDelaySeconds: number | null
    retryGraceSeconds: number
  }): Promise<void> {
    const deliveryStatus = input.outcome === "succeeded" ? "success" : "failed"
    const recoverAfter =
      input.outcome === "pending" && input.retryDelaySeconds !== null
        ? new Date(
            this.now().getTime() +
              (input.retryDelaySeconds + input.retryGraceSeconds) * 1000
          )
        : input.job.recoverAfter
    await this.sql.transaction((transaction) => [
      transaction`
        -- Exactamente una de las dos columnas informada: el check
        -- num_nonnulls(message_id, instagram_comment_id) = 1 de la 0013
        -- rechaza cualquier otra cosa, y el job ya trae uno solo de los dos.
        insert into external_webhook_deliveries (
          message_id, instagram_comment_id, webhook_url, status, status_code,
          error, attempt, job_id, event_id
        )
        values (
          ${input.job.messageId}, ${input.job.commentId}, ${input.job.webhookUrl},
          ${deliveryStatus}, ${input.statusCode}, ${input.error},
          ${input.job.attemptCount}, ${input.job.id}, ${input.job.eventId}
        )
      `,
      transaction`
        update external_webhook_jobs
        set status = ${input.outcome},
          last_status_code = ${input.statusCode},
          last_error = ${input.error},
          recover_after = ${recoverAfter},
          delivered_at = case
            when ${input.outcome} = 'succeeded' then now()
            else delivered_at
          end,
          updated_at = now()
        where id = ${input.job.id}
      `,
    ])
  }

  async markJobDead(jobId: string, error: string): Promise<void> {
    const rows = await this.sql`
      update external_webhook_jobs
      set status = 'dead', last_error = ${error}, updated_at = now()
      where id = ${jobId} and status <> 'succeeded'
      returning id
    `
    if (rows[0]) return
    const existing = await this.getJob(jobId)
    if (existing?.status === "succeeded") return
    throw new Error("webhook job terminal state was not persisted")
  }

  async findRecoverableJobs(input: {
    limit: number
    leaseSeconds: number
  }): Promise<
    Array<{ jobId: string; messageId: string | null; commentId: string | null }>
  > {
    const now = this.now()
    const leaseUntil = new Date(now.getTime() + input.leaseSeconds * 1000)
    const rows = await this.sql`
      with candidates as (
        select id, status
        from external_webhook_jobs
        where status in ('pending', 'processing')
          and recover_after <= ${now}
        order by recover_after asc, id asc
        limit ${input.limit}
        for update skip locked
      )
      update external_webhook_jobs as jobs
      set status = 'pending',
        last_error = case
          when candidates.status = 'processing'
            then coalesce(jobs.last_error, 'recovered stale processing job')
          else jobs.last_error
        end,
        recover_after = ${leaseUntil},
        updated_at = now()
      from candidates
      where jobs.id = candidates.id
      returning jobs.id, jobs.message_id, jobs.instagram_comment_id
    `
    return rows.map((row) => ({
      jobId: text(row.id),
      messageId: nullableText(row.message_id),
      commentId: nullableText(row.instagram_comment_id),
    }))
  }

  listDeliveries(
    tenantId: string,
    messageId: string,
    input: { limit: number; cursor?: string }
  ): Promise<{ data: DeliveryDto[]; pagination: PaginationDto }> {
    return this.queryDeliveries({
      tenantId,
      subject: { kind: "message", id: messageId },
      ...input,
    })
  }

  listCommentDeliveries(
    tenantId: string,
    commentId: string,
    input: { limit: number; cursor?: string }
  ): Promise<{ data: DeliveryDto[]; pagination: PaginationDto }> {
    return this.queryDeliveries({
      tenantId,
      subject: { kind: "comment", id: commentId },
      ...input,
    })
  }

  // Una sola consulta para los dos sujetos. La migración 0013 relajó
  // `external_webhook_deliveries` en vez de crear una segunda tabla porque el
  // consumidor y la política de reintentos son idénticos; esto es esa decisión
  // del lado de la lectura.
  private async queryDeliveries(input: {
    tenantId: string
    subject: { kind: "message" | "comment"; id: string }
    limit: number
    cursor?: string
  }): Promise<{ data: DeliveryDto[]; pagination: PaginationDto }> {
    const isMessage = input.subject.kind === "message"
    const subjectColumn = isMessage ? "message_id" : "instagram_comment_id"
    const subjectTable = isMessage ? "messages" : "instagram_comments"
    const cursor = decodeCursor(input.cursor)
    const parameters: unknown[] = [input.tenantId, input.subject.id]
    let cursorClause = ""
    if (cursor) {
      parameters.push(cursor.at, cursor.id)
      cursorClause = `and (d.attempted_at, d.id) <
        ($3::timestamptz, $4::uuid)`
    }
    const limit = Math.min(input.limit, API_MAX_LIMIT)
    parameters.push(limit + 1)
    const rows = await this.sql.query(
      `select d.id, coalesce(d.event_id, j.event_id, '') as event_id,
         d.attempt, d.status, d.status_code, d.error, d.attempted_at
       from external_webhook_deliveries d
       left join external_webhook_jobs j on j.id = d.job_id
       join ${subjectTable} s on s.id = d.${subjectColumn}
       where s.tenant_id = $1::uuid
         and d.${subjectColumn} = $2::uuid ${cursorClause}
       order by d.attempted_at desc, d.id desc
       limit $${parameters.length}`,
      parameters
    )
    const hasMore = rows.length > limit
    const selected = rows.slice(0, limit)
    const last = selected.at(-1)
    return {
      data: selected.map((row) => ({
        id: text(row.id),
        eventId: text(row.event_id),
        attempt: number(row.attempt, 1),
        status: text(row.status) === "success" ? "success" : "failed",
        statusCode:
          row.status_code === null ? null : number(row.status_code, 0),
        error: nullableText(row.error),
        attemptedAt: iso(row.attempted_at),
      })),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                at: iso(last.attempted_at),
                id: text(last.id),
              })
            : null,
      },
    }
  }

  async getStripeCustomerId(tenantId: string): Promise<string | null> {
    const rows = await this.sql`
      select stripe_customer_id from users where id = ${tenantId} limit 1
    `
    return nullableText(rows[0]?.stripe_customer_id)
  }

  async setStripeCustomerId(
    tenantId: string,
    customerId: string
  ): Promise<void> {
    await this.sql`
      update users
      set stripe_customer_id = ${customerId}, updated_at = now()
      where id = ${tenantId}
    `
  }

  async getTenantIdByStripeCustomerId(
    customerId: string
  ): Promise<string | null> {
    const rows = await this.sql`
      select id from users where stripe_customer_id = ${customerId} limit 1
    `
    return rows[0] ? text(rows[0].id) : null
  }

  async upsertSubscription(
    input: SubscriptionUpsertInput
  ): Promise<SubscriptionUpsertResult> {
    const previous = await this.getSubscription(input.tenantId)
    const supersededSubscriptionId = findSupersededSubscriptionId(
      previous,
      input
    )
    if (!shouldApplySubscriptionEvent(previous, input)) {
      return { applied: false, supersededSubscriptionId }
    }
    await this.sql`
      insert into subscriptions (
        tenant_id, stripe_subscription_id, status, price_lookup_key,
        current_period_start, current_period_end, cancel_at_period_end,
        last_stripe_event_at
      )
      values (
        ${input.tenantId}, ${input.stripeSubscriptionId}, ${input.status},
        ${input.priceLookupKey}, ${input.currentPeriodStart},
        ${input.currentPeriodEnd}, ${input.cancelAtPeriodEnd}, ${input.eventAt}
      )
      on conflict (tenant_id) do update set
        stripe_subscription_id = excluded.stripe_subscription_id,
        status = excluded.status,
        price_lookup_key = excluded.price_lookup_key,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        last_stripe_event_at = excluded.last_stripe_event_at,
        updated_at = now()
    `
    return { applied: true, supersededSubscriptionId }
  }

  async loadDeletionContext(tenantId: string): Promise<{
    email: string
    stripeSubscriptionId: string | null
    pages: Array<{
      // El canal decide contra qué Graph se desuscribe. Sin él, una cuenta de
      // Instagram manda su token al Graph de Facebook: no da un error claro, da
      // un 400, y la cuenta queda recibiendo eventos de un tenant borrado.
      channel: Channel
      providerPageId: string
      status: string
      encryptedPageToken: string
    }>
  } | null> {
    const users = await this.sql`
      select email from users where id = ${tenantId} limit 1
    `
    if (!users[0]) return null
    const [pages, subscriptions] = await Promise.all([
      this.sql`
        select channel, meta_page_id, status, page_access_token_encrypted
        from connected_pages where tenant_id = ${tenantId}
      `,
      this.sql`
        select stripe_subscription_id
        from subscriptions where tenant_id = ${tenantId} limit 1
      `,
    ])
    return {
      email: text(users[0].email),
      stripeSubscriptionId: nullableText(
        subscriptions[0]?.stripe_subscription_id
      ),
      pages: pages.map((row) => ({
        channel: channel(row.channel),
        providerPageId: text(row.meta_page_id),
        status: text(row.status),
        encryptedPageToken: text(row.page_access_token_encrypted),
      })),
    }
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from users where id = ${tenantId} returning id
    `
    return Boolean(rows[0])
  }

  private async queryMessages(
    tenantId: string,
    input: MessageListInput
  ): Promise<{ data: MessageDto[]; pagination: PaginationDto }> {
    const cursor = decodeCursor(input.cursor)
    const parameters: unknown[] = [tenantId]
    const clauses = ["messages.tenant_id = $1"]
    const filters: Array<[unknown, string]> = [
      [input.pageId, "connected_page_id"],
      [input.conversationId, "conversation_id"],
      [input.direction, "direction"],
      [input.status, "status"],
    ]
    for (const [value, column] of filters) {
      if (value !== undefined) {
        parameters.push(value)
        const cast =
          column === "connected_page_id" || column === "conversation_id"
            ? "::uuid"
            : ""
        clauses.push(`messages.${column} = $${parameters.length}${cast}`)
      }
    }
    if (input.createdAfter) {
      parameters.push(input.createdAfter)
      clauses.push(`messages.created_at > $${parameters.length}::timestamptz`)
    }
    if (input.createdBefore) {
      parameters.push(input.createdBefore)
      clauses.push(`messages.created_at < $${parameters.length}::timestamptz`)
    }
    if (cursor) {
      parameters.push(cursor.at, cursor.id)
      clauses.push(
        `(messages.created_at, messages.id) < ($${parameters.length - 1}::timestamptz, $${parameters.length}::uuid)`
      )
    }
    const limit = Math.min(input.limit, API_MAX_LIMIT)
    parameters.push(limit + 1)
    const rows = await this.sql.query(
      `${messageSelect()}
       where ${clauses.join(" and ")}
       order by messages.created_at desc, messages.id desc
       limit $${parameters.length}`,
      parameters
    )
    const hasMore = rows.length > limit
    const selected = rows.slice(0, limit)
    const last = selected.at(-1)
    return {
      data: selected.map((row) => messageDto(mapMessage(row))),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                at: iso(last.created_at),
                id: text(last.id),
              })
            : null,
      },
    }
  }
}

// Proyección compartida por el listado y la lectura puntual de mensajes. Es una
// sola consulta a propósito: pedir los adjuntos por mensaje convertiría una
// página de cien mensajes en ciento un viajes HTTP a Neon, y el `left join
// lateral` los trae agregados en la misma pasada (mismo patrón que
// `conversationSelect`, que ya resuelve así el último mensaje de cada hilo).
//
// Las columnas de la 0015 (`message_type`, `content`, `origin`, `historical`,
// `delivery_status`, `reply_to_meta_message_id`) entran acá: sin ellas un
// adjunto se proyectaría colgando de un mensaje que dice ser de tipo 'text'.
function messageSelect(): string {
  return `select messages.id, messages.tenant_id, messages.conversation_id,
    messages.connected_page_id, messages.contact_id, messages.direction,
    messages.status, messages.text, messages.message_type, messages.content,
    messages.origin, messages.historical, messages.delivery_status,
    messages.reply_to_meta_message_id, messages.meta_message_id,
    messages.instagram_source_comment_id, messages.error,
    messages.provider_response, messages.idempotency_key,
    messages.idempotency_fingerprint, messages.created_at,
    coalesce(attachments.items, '[]'::jsonb) as attachments
  from messages
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'kind', a.kind,
        'mimeType', a.mime_type,
        'filename', a.filename,
        'caption', a.caption,
        'sizeBytes', a.size_bytes,
        'sha256', a.sha256,
        'status', a.status
      )
      order by a.created_at, a.id
    ) as items
    from message_attachments a
    where a.message_id = messages.id
  ) attachments on true`
}

function conversationSelect(): string {
  return `select
    c.id, c.tenant_id, c.connected_page_id, c.contact_id, c.contact_name,
    c.last_message_at, c.created_at, c.updated_at,
    p.meta_page_id, p.name as page_name,
    latest.id as latest_id, latest.text as latest_text,
    latest.direction as latest_direction, latest.status as latest_status,
    latest.created_at as latest_created_at
  from conversations c
  join connected_pages p on p.id = c.connected_page_id
  left join lateral (
    select id, text, direction, status, created_at
    from messages m
    where m.tenant_id = c.tenant_id and m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true`
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: text(row.id),
    email: text(row.email),
    passwordHash: text(row.password_hash),
    waitlisted: row.waitlisted === true,
    createdAt: date(row.created_at),
  }
}

function mapSubscription(row: Record<string, unknown>): SubscriptionRecord {
  return {
    tenantId: text(row.tenant_id),
    stripeSubscriptionId: text(row.stripe_subscription_id),
    status: text(row.status),
    priceLookupKey: text(row.price_lookup_key),
    currentPeriodStart: nullableDate(row.current_period_start),
    currentPeriodEnd: nullableDate(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    lastStripeEventAt: nullableDate(row.last_stripe_event_at),
  }
}

function mapPage(row: Record<string, unknown>): PageRecord {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    channel: channel(row.channel),
    providerPageId: text(row.meta_page_id),
    name: text(row.name),
    username: nullableText(row.username),
    status: text(row.status) === "disconnected" ? "disconnected" : "active",
    tokenStatus: text(row.token_status) === "invalid" ? "invalid" : "valid",
    tokenError: nullableText(row.token_error),
    tokenExpiresAt: nullableDate(row.token_expires_at),
    webhookUrl: nullableText(row.webhook_url),
    pageAccessTokenEncrypted: text(row.page_access_token_encrypted),
    webhookSigningSecretEncrypted: nullableText(
      row.webhook_signing_secret_encrypted
    ),
    wabaId: nullableText(row.waba_id),
    phoneE164: nullableText(row.whatsapp_phone_e164),
    onboardingMode: onboardingMode(row.onboarding_mode),
    coexistenceStatus: nullableText(row.coexistence_status),
    historySyncStatus: nullableText(row.history_sync_status),
    connectedAt: date(row.connected_at),
    updatedAt: date(row.updated_at),
  }
}

export function pageDto(page: PageRecord): PageDto {
  return {
    id: page.id,
    // `provider` sigue siendo "meta" para los dos canales: Instagram es Meta.
    // Lo que discrimina la superficie es `channel`.
    provider: "meta",
    channel: page.channel,
    providerPageId: page.providerPageId,
    name: page.name,
    username: page.username,
    wabaId: page.wabaId,
    phoneE164: page.phoneE164,
    onboardingMode: page.onboardingMode,
    whatsappStatus:
      page.channel === "whatsapp"
        ? {
            coexistence: page.coexistenceStatus,
            historySync: page.historySyncStatus,
          }
        : null,
    status: page.status,
    tokenStatus: page.tokenStatus,
    webhook: {
      url: page.webhookUrl,
      signingEnabled: Boolean(page.webhookSigningSecretEncrypted),
    },
    connectedAt: page.connectedAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }
}

function mapConversation(row: Record<string, unknown>): ConversationRecord {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    pageId: text(row.connected_page_id),
    contactId: text(row.contact_id),
    contactName: nullableText(row.contact_name),
    lastMessageAt: date(row.last_message_at),
  }
}

function mapConversationDto(row: Record<string, unknown>): ConversationDto {
  const latestId = nullableText(row.latest_id)
  return {
    id: text(row.id),
    page: {
      id: text(row.connected_page_id),
      providerPageId: text(row.meta_page_id),
      name: text(row.page_name),
    },
    contact: {
      id: text(row.contact_id),
      name: nullableText(row.contact_name),
    },
    latestMessage: latestId
      ? {
          id: latestId,
          text: nullableText(row.latest_text),
          direction:
            text(row.latest_direction) === "outbound" ? "outbound" : "inbound",
          status: messageStatus(row.latest_status),
          createdAt: iso(row.latest_created_at),
        }
      : null,
    lastMessageAt: iso(row.last_message_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function mapMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    conversationId: text(row.conversation_id),
    pageId: text(row.connected_page_id),
    contactId: text(row.contact_id),
    direction: text(row.direction) === "outbound" ? "outbound" : "inbound",
    status: messageStatus(row.status),
    text: nullableText(row.text),
    type: messageType(row.message_type),
    content: row.content ?? null,
    origin: messageOrigin(row.origin),
    historical: row.historical === true,
    deliveryStatus: deliveryStatus(row.delivery_status),
    replyToProviderMessageId: nullableText(row.reply_to_meta_message_id),
    providerMessageId: nullableText(row.meta_message_id),
    attachments: mapAttachments(row.attachments),
    sourceCommentId: nullableText(row.instagram_source_comment_id),
    error: nullableText(row.error),
    providerResponse: row.provider_response ?? null,
    idempotencyKey: nullableText(row.idempotency_key),
    idempotencyFingerprint: nullableText(row.idempotency_fingerprint),
    createdAt: date(row.created_at),
  }
}

export function messageDto(message: MessageRecord): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    pageId: message.pageId,
    contactId: message.contactId,
    direction: message.direction,
    status: message.status,
    type: message.type,
    text: message.text,
    // `content` lo escriben solo los parsers de webhook con el shape del
    // contrato, la misma confianza que ya se le da a `provider_response`.
    content: (message.content ?? null) as MessageContent | null,
    attachments: message.attachments ?? [],
    // Antes de 0015 la columna no existía, pero la semántica sí: todo entrante
    // vino del cliente y todo saliente salió por la API.
    origin:
      message.origin ??
      (message.direction === "inbound" ? "customer" : "resender_api"),
    historical: message.historical,
    deliveryStatus: message.deliveryStatus,
    replyTo: message.replyToProviderMessageId
      ? { providerMessageId: message.replyToProviderMessageId }
      : null,
    provider: {
      name: "meta",
      messageId: message.providerMessageId,
    },
    failure: message.error ? { message: message.error } : null,
    sourceCommentId: message.sourceCommentId,
    createdAt: message.createdAt.toISOString(),
  }
}

function mapComment(row: Record<string, unknown>): CommentRecord {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    pageId: text(row.connected_page_id),
    providerCommentId: nullableText(row.ig_comment_id),
    parentCommentId: nullableText(row.parent_ig_comment_id),
    mediaId: text(row.media_id),
    mediaProductType: nullableText(row.media_product_type),
    fromProviderUserId: text(row.from_ig_id),
    fromUsername: nullableText(row.from_username),
    direction: text(row.direction) === "outbound" ? "outbound" : "inbound",
    status: messageStatus(row.status),
    text: text(row.text),
    error: nullableText(row.error),
    idempotencyKey: nullableText(row.idempotency_key),
    createdAt: date(row.created_at),
  }
}

export function commentDto(comment: CommentRecord): CommentDto {
  return {
    id: comment.id,
    pageId: comment.pageId,
    providerCommentId: comment.providerCommentId,
    parentCommentId: comment.parentCommentId,
    mediaId: comment.mediaId,
    mediaProductType: comment.mediaProductType,
    from: {
      providerUserId: comment.fromProviderUserId,
      username: comment.fromUsername,
    },
    direction: comment.direction,
    status: comment.status,
    text: comment.text,
    failure: comment.error ? { message: comment.error } : null,
    createdAt: comment.createdAt.toISOString(),
  }
}

function channel(value: unknown): Channel {
  // El default de la columna es 'messenger' y las filas anteriores a la 0013
  // quedaron ahí sin backfill, así que cualquier valor que no sea 'instagram'
  // ni 'whatsapp' es Messenger.
  //
  // Deliberadamente **no** pasa por `text()`, que tira ante un valor ausente:
  // una fila legítima leída por una consulta que todavía no selecciona la
  // columna se convertiría en un 500, y el canal correcto para ese caso ya es
  // el default de la columna.
  if (value === "instagram" || value === "whatsapp") return value
  return "messenger"
}

// Los tres helpers siguientes comparten el criterio de `channel()`: el check
// de la migración 0015 ya garantiza los valores en BD, y una consulta que
// todavía no selecciona la columna cae en el default correcto en vez de tirar.

function messageType(value: unknown): MessageRecord["type"] {
  if (
    value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "document" ||
    value === "sticker" ||
    value === "contacts" ||
    value === "location" ||
    value === "reaction" ||
    value === "interactive" ||
    value === "system" ||
    value === "order" ||
    value === "unknown"
  ) {
    return value
  }
  return "text"
}

function messageOrigin(value: unknown): MessageRecord["origin"] {
  if (
    value === "customer" ||
    value === "resender_api" ||
    value === "business_app" ||
    value === "history" ||
    value === "system"
  ) {
    return value
  }
  return null
}

function deliveryStatus(value: unknown): MessageRecord["deliveryStatus"] {
  if (
    value === "accepted" ||
    value === "sent" ||
    value === "delivered" ||
    value === "read" ||
    value === "failed" ||
    value === "deleted"
  ) {
    return value
  }
  return null
}

function onboardingMode(value: unknown): PageRecord["onboardingMode"] {
  if (value === "standard" || value === "coexistence") return value
  return null
}

// `message_attachments.mime_type` es `not null` y el webhook de Meta no siempre
// manda `mime_type` —los stickers y algún audio llegan sin él—. Este es el
// "octetos sin interpretar" del estándar: no afirma un tipo que no sabemos, y el
// job de descarga lo reemplaza con el `Content-Type` que devuelva Meta. La
// alternativa, inventar `image/jpeg` por el `kind`, se serviría al navegador
// como una mentira difícil de detectar.
const UNKNOWN_MEDIA_MIME_TYPE = "application/octet-stream"

function mapAttachments(value: unknown): AttachmentDto[] {
  // El agregado llega como jsonb; una consulta que no lo proyecta deja el campo
  // ausente y el mensaje se queda sin adjuntos en vez de reventar, igual que
  // hacen `channel()` y compañía con las columnas que no se seleccionan.
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (raw === null || typeof raw !== "object") return []
    const row = raw as Record<string, unknown>
    const id = nullableText(row.id)
    if (!id) return []
    return [
      {
        id,
        kind: attachmentKind(row.kind),
        mimeType: nullableText(row.mimeType) ?? UNKNOWN_MEDIA_MIME_TYPE,
        filename: nullableText(row.filename),
        caption: nullableText(row.caption),
        sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : null,
        sha256: nullableText(row.sha256),
        status: attachmentStatus(row.status),
        // Null mientras no exista el endpoint de descarga. La regla del
        // contrato es que solo un adjunto `available` la lleva, y `pending` es
        // el estado en el que nacen: publicar una URL que todavía no resuelve
        // sería peor que no publicar ninguna.
        downloadUrl: null,
      },
    ]
  })
}

// Mismo criterio que `messageType()`: el CHECK de la 0015 ya garantiza los
// valores en base, así que estos dos solo existen para que un jsonb malformado
// no tumbe la lectura de un mensaje entero por un adjunto.

function attachmentKind(value: unknown): AttachmentDto["kind"] {
  if (
    value === "audio" ||
    value === "video" ||
    value === "document" ||
    value === "sticker"
  ) {
    return value
  }
  return "image"
}

function attachmentStatus(value: unknown): AttachmentDto["status"] {
  if (
    value === "available" ||
    value === "failed" ||
    value === "deleted" ||
    value === "pending"
  ) {
    return value
  }
  return "pending"
}

function whatsappIngestResult(
  inserted: boolean,
  row: Record<string, unknown>
): WhatsappIngestResult {
  const messageId = text(row.message_id)
  const jobId = nullableText(row.job_id)
  // Sin job no hay entrega: es un mensaje del historial. Las llaves del job se
  // apagan enteras para que nadie encole por accidente un id que no existe.
  if (!jobId) {
    return {
      inserted,
      messageId,
      jobId: null,
      jobStatus: null,
      jobAttemptCount: 0,
      jobRecoverAfter: null,
    }
  }
  return {
    inserted,
    messageId,
    jobId,
    jobStatus: jobStatus(row.job_status),
    jobAttemptCount: number(row.job_attempt_count, 0),
    jobRecoverAfter: date(row.job_recover_after),
  }
}

// Los `errors[]` de Meta llegan en tres sitios distintos (mensaje
// `unsupported`, status `failed`, chunk de historia rechazado) y `messages.error`
// es una sola columna de texto: la misma en la que ya se leen los fallos de
// envío, para no inventarle al producto un segundo lugar donde mirar. Se
// conserva el código numérico porque es lo único que separa un 131047
// (reengagement) de un 131051 (tipo no soportado) cuando el título viene vacío.
function formatWhatsappErrors(errors: WhatsappError[]): string | null {
  const lines = errors
    .map((error) =>
      [
        error.code === null ? null : String(error.code),
        error.title,
        error.message,
        error.details,
      ]
        .filter((part): part is string => Boolean(part))
        .join(": ")
    )
    .filter((line) => line !== "")
  return lines.length > 0 ? lines.join(" | ") : null
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "")
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: text(row.id),
    eventId: text(row.event_id),
    tenantId: text(row.tenant_id),
    messageId: nullableText(row.message_id),
    commentId: nullableText(row.instagram_comment_id),
    connectionId: text(row.connected_page_id),
    channel: channel(row.channel),
    providerPageId: text(row.meta_page_id),
    username: nullableText(row.username),
    webhookUrl: nullableText(row.webhook_url),
    payload: row.payload,
    status: jobStatus(row.status),
    attemptCount: number(row.attempt_count, 0),
    recoverAfter: date(row.recover_after),
    signingSecretEncrypted: nullableText(row.webhook_signing_secret_encrypted),
  }
}

function messageStatus(value: unknown): MessageRecord["status"] {
  const normalized = text(value)
  if (normalized === "sent" || normalized === "failed") return normalized
  return "received"
}

function jobStatus(value: unknown): JobRecord["status"] {
  const normalized = text(value)
  if (
    normalized === "processing" ||
    normalized === "succeeded" ||
    normalized === "failed_permanent" ||
    normalized === "dead"
  ) {
    return normalized
  }
  return "pending"
}

function rowValue(
  row: Record<string, unknown> | undefined,
  key: string
): unknown {
  return row?.[key]
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid database text value")
  return value
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function number(value: unknown, fallback: number): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function date(value: unknown): Date {
  const result = value instanceof Date ? value : new Date(text(value))
  if (Number.isNaN(result.getTime())) throw new Error("invalid database date")
  return result
}

function nullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : date(value)
}

function iso(value: unknown): string {
  return date(value).toISOString()
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value)
}
