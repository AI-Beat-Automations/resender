import type {
  ApiKeyDto,
  ConversationDto,
  ConversationListInput,
  DeliveryDto,
  MessageDto,
  MessageListInput,
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
  providerPageId: string
  name: string
  status: "active" | "disconnected"
  tokenStatus: "valid" | "invalid"
  tokenError: string | null
  webhookUrl: string | null
  pageAccessTokenEncrypted: string
  webhookSigningSecretEncrypted: string | null
  connectedAt: Date
  updatedAt: Date
}

export type MessageRecord = {
  id: string
  tenantId: string
  conversationId: string
  pageId: string
  contactId: string
  direction: "inbound" | "outbound"
  status: "received" | "sent" | "failed"
  text: string
  providerMessageId: string | null
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
  messageId: string
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

  async countActivePages(tenantId: string): Promise<number> {
    const rows = await this.sql`
      select count(*)::int as count
      from connected_pages
      where tenant_id = ${tenantId} and status = 'active'
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
      `select id, tenant_id, meta_page_id, name, status, token_status,
         token_error, webhook_url, page_access_token_encrypted,
         webhook_signing_secret_encrypted, connected_at, updated_at
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
      select id, tenant_id, meta_page_id, name, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, connected_at, updated_at
      from connected_pages
      where tenant_id = ${tenantId}
      order by case when status = 'active' then 0 else 1 end, updated_at desc
    `
    return rows.map((row) => pageDto(mapPage(row)))
  }

  async getPage(tenantId: string, pageId: string): Promise<PageRecord | null> {
    const rows = await this.sql`
      select id, tenant_id, meta_page_id, name, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, connected_at, updated_at
      from connected_pages
      where tenant_id = ${tenantId} and id = ${pageId}
      limit 1
    `
    return rows[0] ? mapPage(rows[0]) : null
  }

  async getActivePageByProviderId(
    providerPageId: string
  ): Promise<PageRecord | null> {
    const rows = await this.sql`
      select id, tenant_id, meta_page_id, name, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, connected_at, updated_at
      from connected_pages
      where meta_page_id = ${providerPageId} and status = 'active'
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
      returning id, tenant_id, meta_page_id, name, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, connected_at, updated_at
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
      returning id, tenant_id, meta_page_id, name, status, token_status,
        token_error, webhook_url, page_access_token_encrypted,
        webhook_signing_secret_encrypted, connected_at, updated_at
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

  async getPageOwnership(providerPageIds: string[]) {
    if (providerPageIds.length === 0) return []
    const rows = await this.sql.query(
      `select meta_page_id, tenant_id, status
       from connected_pages
       where meta_page_id = any($1::text[])`,
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
            tenant_id, meta_page_id, name, page_access_token_encrypted
          )
          values (
            ${tenantId},
            ${page.providerPageId},
            ${page.name},
            ${page.encryptedPageToken}
          )
          on conflict (meta_page_id) do update set
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
          returning id, tenant_id, meta_page_id, name, status, token_status,
            token_error, webhook_url, page_access_token_encrypted,
            webhook_signing_secret_encrypted, connected_at, updated_at
        `
      )
    )
    const rows = results.flat()
    if (rows.length !== pages.length) {
      throw new Error("page ownership changed during connection")
    }
    return rows.map((row) => pageDto(mapPage(row)))
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
    const rows = await this.sql`
      select id, tenant_id, conversation_id, connected_page_id, contact_id,
        direction, status, text, meta_message_id, error, provider_response,
        idempotency_key, idempotency_fingerprint, created_at
      from messages
      where tenant_id = ${tenantId} and id = ${messageId}
      limit 1
    `
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

  async getOutboundByIdempotency(
    tenantId: string,
    idempotencyKey: string
  ): Promise<MessageRecord | null> {
    const existingRows = await this.sql`
      select id, tenant_id, conversation_id, connected_page_id, contact_id,
        direction, status, text, meta_message_id, error, provider_response,
        idempotency_key, idempotency_fingerprint, created_at
      from messages
      where tenant_id = ${tenantId}
        and idempotency_key = ${idempotencyKey}
        and direction = 'outbound'
      limit 1
    `
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
  }): Promise<MessageRecord> {
    const providerResponse = JSON.stringify(input.providerResponse ?? null)
    const rows = await this.sql`
      with inserted as (
        insert into messages (
          tenant_id, conversation_id, connected_page_id, contact_id,
          direction, status, text, meta_message_id, idempotency_key,
          idempotency_fingerprint, error, provider_response, created_at
        )
        values (
          ${input.tenantId}, ${input.conversationId}, ${input.pageId},
          ${input.contactId}, 'outbound', ${input.status}, ${input.text},
          ${input.providerMessageId}, ${input.idempotencyKey},
          ${input.fingerprint}, ${input.error}, ${providerResponse}::jsonb,
          ${input.createdAt}
        )
        returning id, tenant_id, conversation_id, connected_page_id,
          contact_id, direction, status, text, meta_message_id, error,
          provider_response, idempotency_key, idempotency_fingerprint,
          created_at
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
          tenant_id, connected_page_id, contact_id, last_message_at
        )
        values (
          ${input.page.tenantId}, ${input.page.id}, ${input.contactId},
          ${input.createdAt}
        )
        on conflict (connected_page_id, contact_id) do update set
          last_message_at = greatest(
            conversations.last_message_at,
            excluded.last_message_at
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
          jsonb_build_object(
            'id', ${input.eventId},
            'type', 'message.received',
            'createdAt', ${input.createdAt.toISOString()},
            'data', jsonb_build_object(
              'page', jsonb_build_object(
                'id', ${input.page.id},
                'providerPageId', ${input.page.providerPageId},
                'name', ${input.page.name}
              ),
              'conversation', jsonb_build_object(
                'id', inserted_message.conversation_id,
                'contact', jsonb_build_object(
                  'id', ${input.contactId},
                  'name', (select contact_name from conversation)
                )
              ),
              'message', jsonb_build_object(
                'id', inserted_message.id,
                'direction', 'inbound',
                'status', 'received',
                'type', 'text',
                'text', ${input.text},
                'provider', jsonb_build_object(
                  'name', 'meta',
                  'messageId', ${input.providerMessageId}
                ),
                'createdAt', ${input.createdAt.toISOString()}
              )
            )
          ),
          case
            when not ${input.deliveryEnabled}
              or ${input.page.webhookUrl}::text is null
              then 'failed_permanent'
            else 'pending'
          end,
          case
            when not ${input.deliveryEnabled}
              then ${input.deliveryBlockedReason}
            when ${input.page.webhookUrl}::text is null
              then 'webhook URL is not configured'
            else null
          end,
          ${input.recoverAfter}
        from inserted_message
        on conflict (message_id) do nothing
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

  async getJob(jobId: string): Promise<JobRecord | null> {
    const rows = await this.sql`
      select j.id, j.event_id, j.tenant_id, j.message_id, j.webhook_url,
        j.payload, j.status, j.attempt_count, j.recover_after,
        p.webhook_signing_secret_encrypted
      from external_webhook_jobs j
      join messages m on m.id = j.message_id
      join connected_pages p on p.id = m.connected_page_id
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
        insert into external_webhook_deliveries (
          message_id, webhook_url, status, status_code, error, attempt,
          job_id, event_id
        )
        values (
          ${input.job.messageId}, ${input.job.webhookUrl}, ${deliveryStatus},
          ${input.statusCode}, ${input.error}, ${input.job.attemptCount},
          ${input.job.id}, ${input.job.eventId}
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
  }): Promise<Array<{ jobId: string; messageId: string }>> {
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
      returning jobs.id, jobs.message_id
    `
    return rows.map((row) => ({
      jobId: text(row.id),
      messageId: text(row.message_id),
    }))
  }

  async listDeliveries(
    tenantId: string,
    messageId: string,
    input: { limit: number; cursor?: string }
  ): Promise<{ data: DeliveryDto[]; pagination: PaginationDto }> {
    const cursor = decodeCursor(input.cursor)
    const parameters: unknown[] = [tenantId, messageId]
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
       join messages m on m.id = d.message_id
       where m.tenant_id = $1::uuid and d.message_id = $2::uuid ${cursorClause}
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
        select meta_page_id, status, page_access_token_encrypted
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
    const clauses = ["tenant_id = $1"]
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
        clauses.push(`${column} = $${parameters.length}${cast}`)
      }
    }
    if (input.createdAfter) {
      parameters.push(input.createdAfter)
      clauses.push(`created_at > $${parameters.length}::timestamptz`)
    }
    if (input.createdBefore) {
      parameters.push(input.createdBefore)
      clauses.push(`created_at < $${parameters.length}::timestamptz`)
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
      `select id, tenant_id, conversation_id, connected_page_id, contact_id,
         direction, status, text, meta_message_id, error, provider_response,
         idempotency_key, idempotency_fingerprint, created_at
       from messages
       where ${clauses.join(" and ")}
       order by created_at desc, id desc
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
    providerPageId: text(row.meta_page_id),
    name: text(row.name),
    status: text(row.status) === "disconnected" ? "disconnected" : "active",
    tokenStatus: text(row.token_status) === "invalid" ? "invalid" : "valid",
    tokenError: nullableText(row.token_error),
    webhookUrl: nullableText(row.webhook_url),
    pageAccessTokenEncrypted: text(row.page_access_token_encrypted),
    webhookSigningSecretEncrypted: nullableText(
      row.webhook_signing_secret_encrypted
    ),
    connectedAt: date(row.connected_at),
    updatedAt: date(row.updated_at),
  }
}

export function pageDto(page: PageRecord): PageDto {
  return {
    id: page.id,
    provider: "meta",
    providerPageId: page.providerPageId,
    name: page.name,
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
          text: text(row.latest_text),
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
    text: text(row.text),
    providerMessageId: nullableText(row.meta_message_id),
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
    type: "text",
    text: message.text,
    provider: {
      name: "meta",
      messageId: message.providerMessageId,
    },
    failure: message.error ? { message: message.error } : null,
    createdAt: message.createdAt.toISOString(),
  }
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: text(row.id),
    eventId: text(row.event_id),
    tenantId: text(row.tenant_id),
    messageId: text(row.message_id),
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
