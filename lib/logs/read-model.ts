// Lectura de la sección Logs (`request_logs`, migración 0028). Solo la lee el
// padre: el alcance es el tenant entero, y el filtro por cliente es de vista
// (mismo criterio que Inbox, `clientFilterPredicate`).
//
// Las tres consultas repiten el mismo `where` en vez de compartirlo: el driver
// HTTP de Neon no arma fragmentos `sql` anidados. Cada filtro apagado llega
// como `null` y su predicado se cortocircuita, así el SQL es estático.

import {
  clientFilterPredicate,
  type ClientFilter,
} from "@/lib/clients/client-filter"
import { getSql } from "@/lib/db"
import type { PageChannel } from "@/lib/pages/page-registry"

import {
  decodeLogCursor,
  encodeLogCursor,
  periodStart,
  type LogFilters,
} from "./log-filters"
import type { RequestLogDirection, RequestLogStatus } from "./request-log"

export const LOGS_PAGE_SIZE = 50

export type RequestLogRow = {
  id: string
  createdAt: Date
  direction: RequestLogDirection
  status: RequestLogStatus
  channel: PageChannel
  eventType: string
  method: string
  endpoint: string
  httpStatus: number | null
  durationMs: number | null
  accountName: string | null
  accountExternalId: string | null
  clientAccountId: string | null
}

export type RequestLogDetail = RequestLogRow & {
  updatedAt: Date
  eventId: string | null
  requestId: string | null
  messageId: string | null
  instagramCommentId: string | null
  conversationId: string | null
  providerMessageId: string | null
  contactId: string | null
  attemptCount: number
  maxAttempts: number | null
  nextRetryAt: Date | null
  signed: boolean | null
  errorCode: string | null
  errorMessage: string | null
  skipReason: string | null
  requestBody: string | null
  responseBody: string | null
  requestTruncated: boolean
  responseTruncated: boolean
  /** Si la conversación sigue existiendo: decide si se ofrece «Ver conversación». */
  conversationExists: boolean
}

export type RequestLogFacets = {
  status: Record<RequestLogStatus, number>
  direction: Record<RequestLogDirection, number>
}

export type LogQuery = {
  tenantId: string
  filters: LogFilters
  clientFilter: ClientFilter
  now?: Date
}

/** `{a,b}` para castear a `text[]`, o null si el filtro está apagado. Los
 * valores ya pasaron por el catálogo cerrado de `parseLogFilters`. */
function arrayParam(values: readonly string[]): string | null {
  return values.length > 0 ? `{${values.join(",")}}` : null
}

function httpRange(filters: LogFilters): [number | null, number | null] {
  switch (filters.http) {
    case "2xx":
      return [200, 299]
    case "4xx":
      return [400, 499]
    case "5xx":
      return [500, 599]
    default:
      return [null, null]
  }
}

function searchPattern(search: string): string | null {
  if (!search) return null
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

function queryParams(query: LogQuery) {
  const { filters } = query
  const client = clientFilterPredicate(query.clientFilter)
  const [httpMin, httpMax] = httpRange(filters)
  return {
    since: periodStart(filters.period, query.now ?? new Date()),
    statuses: arrayParam(filters.statuses),
    directions: arrayParam(filters.directions),
    channels: arrayParam(filters.channels),
    own: client.own,
    clientAccountId: client.clientAccountId,
    accountId: filters.accountId,
    httpMin,
    httpMax,
    pattern: searchPattern(filters.search),
    related: filters.relatedTo,
  }
}

export async function listRequestLogs(
  query: LogQuery & { cursor?: string | null; limit?: number }
): Promise<{ rows: RequestLogRow[]; nextCursor: string | null }> {
  const sql = getSql()
  const p = queryParams(query)
  const cursor = decodeLogCursor(query.cursor)
  const limit = query.limit ?? LOGS_PAGE_SIZE
  // `cursor_ts` sale como texto con microsegundos: un `Date` de JS los pierde y
  // dos filas del mismo milisegundo se saltarían o se repetirían al paginar.
  const rows = await sql`
    select l.id, l.created_at, l.direction, l.status, l.channel, l.event_type,
      l.method, l.endpoint, l.http_status, l.duration_ms, l.account_name,
      l.account_external_id, l.client_account_id,
      to_char(l.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
    from request_logs l
    where l.tenant_id = ${query.tenantId}
      and (${p.related}::uuid is not null or l.created_at >= ${p.since})
      and (${p.statuses}::text[] is null or l.status = any(${p.statuses}::text[]))
      and (${p.directions}::text[] is null
        or l.direction = any(${p.directions}::text[]))
      and (${p.channels}::text[] is null
        or l.channel = any(${p.channels}::text[]))
      and (not ${p.own} or l.client_account_id is null)
      and (${p.clientAccountId}::uuid is null
        or l.client_account_id = ${p.clientAccountId}::uuid)
      and (${p.accountId}::uuid is null
        or l.connected_page_id = ${p.accountId}::uuid)
      and (${p.httpMin}::int is null
        or l.http_status between ${p.httpMin}::int and ${p.httpMax}::int)
      and (${p.pattern}::text is null
        or l.endpoint ilike ${p.pattern}
        or l.event_id ilike ${p.pattern}
        or l.contact_id ilike ${p.pattern}
        or l.provider_message_id ilike ${p.pattern}
        or l.request_id ilike ${p.pattern}
        or l.error_message ilike ${p.pattern})
      and (${p.related}::uuid is null or exists (
        select 1 from request_logs r
        where r.id = ${p.related}::uuid and r.tenant_id = l.tenant_id and (
          r.id = l.id
          or (r.message_id is not null and r.message_id = l.message_id)
          or (r.instagram_comment_id is not null
            and r.instagram_comment_id = l.instagram_comment_id)
          or (r.provider_message_id is not null
            and r.provider_message_id = l.provider_message_id)
          or (r.event_id is not null and r.event_id = l.event_id)
        )
      ))
      and (${cursor?.createdAt ?? null}::timestamptz is null
        or (l.created_at, l.id) < (
          ${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid
        ))
    order by l.created_at desc, l.id desc
    limit ${limit + 1}
  `
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    rows: page.map(mapRow),
    nextCursor:
      rows.length > limit && last
        ? encodeLogCursor({
            createdAt: String(last.cursor_ts),
            id: String(last.id),
          })
        : null,
  }
}

/**
 * Conteos junto a cada casilla. Cada faceta cuenta con **todos los demás
 * filtros puestos menos el propio**: tildar «Failed» no pone en cero a
 * «Success», que es lo que haría contar sobre el resultado ya filtrado.
 */
export async function countRequestLogFacets(
  query: LogQuery
): Promise<RequestLogFacets> {
  const sql = getSql()
  const p = queryParams(query)
  const rows = await sql`
    select
      count(*) filter (where status = 'success' and dir_ok) as success,
      count(*) filter (where status = 'failed' and dir_ok) as failed,
      count(*) filter (where status = 'retrying' and dir_ok) as retrying,
      count(*) filter (where status = 'skipped' and dir_ok) as skipped,
      count(*) filter (where direction = 'meta_to_resender' and status_ok)
        as meta_to_resender,
      count(*) filter (where direction = 'resender_to_bot' and status_ok)
        as resender_to_bot,
      count(*) filter (where direction = 'bot_to_resender' and status_ok)
        as bot_to_resender
    from (
      select l.status, l.direction,
        (${p.statuses}::text[] is null
          or l.status = any(${p.statuses}::text[])) as status_ok,
        (${p.directions}::text[] is null
          or l.direction = any(${p.directions}::text[])) as dir_ok
      from request_logs l
      where l.tenant_id = ${query.tenantId}
        and (${p.related}::uuid is not null or l.created_at >= ${p.since})
        and (${p.channels}::text[] is null
          or l.channel = any(${p.channels}::text[]))
        and (not ${p.own} or l.client_account_id is null)
        and (${p.clientAccountId}::uuid is null
          or l.client_account_id = ${p.clientAccountId}::uuid)
        and (${p.accountId}::uuid is null
          or l.connected_page_id = ${p.accountId}::uuid)
        and (${p.httpMin}::int is null
          or l.http_status between ${p.httpMin}::int and ${p.httpMax}::int)
        and (${p.pattern}::text is null
          or l.endpoint ilike ${p.pattern}
          or l.event_id ilike ${p.pattern}
          or l.contact_id ilike ${p.pattern}
          or l.provider_message_id ilike ${p.pattern}
          or l.request_id ilike ${p.pattern}
          or l.error_message ilike ${p.pattern})
        and (${p.related}::uuid is null or exists (
          select 1 from request_logs r
          where r.id = ${p.related}::uuid and r.tenant_id = l.tenant_id and (
            r.id = l.id
            or (r.message_id is not null and r.message_id = l.message_id)
            or (r.instagram_comment_id is not null
              and r.instagram_comment_id = l.instagram_comment_id)
            or (r.provider_message_id is not null
              and r.provider_message_id = l.provider_message_id)
            or (r.event_id is not null and r.event_id = l.event_id)
          )
        ))
    ) scoped
  `
  const row = rows[0] ?? {}
  return {
    status: {
      success: Number(row.success ?? 0),
      failed: Number(row.failed ?? 0),
      retrying: Number(row.retrying ?? 0),
      skipped: Number(row.skipped ?? 0),
    },
    direction: {
      meta_to_resender: Number(row.meta_to_resender ?? 0),
      resender_to_bot: Number(row.resender_to_bot ?? 0),
      bot_to_resender: Number(row.bot_to_resender ?? 0),
    },
  }
}

export async function getRequestLog(
  tenantId: string,
  id: string
): Promise<RequestLogDetail | null> {
  const sql = getSql()
  const rows = await sql`
    select l.*,
      exists (
        select 1 from conversations c
        where c.id = l.conversation_id and c.tenant_id = l.tenant_id
      ) as conversation_exists
    from request_logs l
    where l.id = ${id}::uuid and l.tenant_id = ${tenantId}
    limit 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    ...mapRow(row),
    updatedAt: date(row.updated_at),
    eventId: text(row.event_id),
    requestId: text(row.request_id),
    messageId: text(row.message_id),
    instagramCommentId: text(row.instagram_comment_id),
    conversationId: text(row.conversation_id),
    providerMessageId: text(row.provider_message_id),
    contactId: text(row.contact_id),
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: row.max_attempts === null ? null : Number(row.max_attempts),
    nextRetryAt: row.next_retry_at ? date(row.next_retry_at) : null,
    signed: typeof row.signed === "boolean" ? row.signed : null,
    errorCode: text(row.error_code),
    errorMessage: text(row.error_message),
    skipReason: text(row.skip_reason),
    requestBody: text(row.request_body),
    responseBody: text(row.response_body),
    requestTruncated: row.request_truncated === true,
    responseTruncated: row.response_truncated === true,
    conversationExists: row.conversation_exists === true,
  }
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function mapRow(row: Record<string, unknown>): RequestLogRow {
  return {
    id: String(row.id),
    createdAt: date(row.created_at),
    direction: row.direction as RequestLogDirection,
    status: row.status as RequestLogStatus,
    channel: row.channel as PageChannel,
    eventType: String(row.event_type),
    method: String(row.method),
    endpoint: String(row.endpoint),
    httpStatus: row.http_status === null ? null : Number(row.http_status),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    accountName: text(row.account_name),
    accountExternalId: text(row.account_external_id),
    clientAccountId: text(row.client_account_id),
  }
}
