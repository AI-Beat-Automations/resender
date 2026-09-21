// Escritura de la bitácora de la sección Logs (`request_logs`, migración 0028).
//
// **Todo lo que exporta este módulo es best-effort y no lanza nunca.** Se llama
// desde las rutas calientes —el webhook de Meta, los `/send`, el consumidor de
// la cola— y la regla del producto es que recibir y enviar mensajes no lo
// bloquea nada: si la escritura falla, se pierde una fila de pantalla y queda
// una línea `request_log_write` en Workers Logs. Nunca un mensaje.
//
// Tres direcciones, tres escritores:
//   - `logInboundEvent`     Meta → Resender, una fila por evento ya atribuido.
//   - `logDeliveryAttempt`  Resender → bot, **una fila por entrega** que se
//     actualiza en cada intento (upsert por `job_id`), más `logDeliveryOutcome`
//     para lo que no llega a tener job (omitidos, URL inválida) y
//     `logDeliveryDead` para el cierre por DLQ.
//   - `logApiRequest`       bot → Resender, una fila por request a la API.

import { getSql } from "@/lib/db"
import type { DeliverySubject } from "@/lib/inbound/external-push"
import { formatAccountShortLabel } from "@/lib/messages/display"
import { describeError, log } from "@/lib/observability/logger"
import type { PageChannel } from "@/lib/pages/page-registry"

import { REQUEST_LOG_RETENTION_DAYS } from "./retention"


/** Tope por cuerpo guardado. Pasado esto se corta y se marca `truncated`. */
export const REQUEST_LOG_BODY_LIMIT = 64 * 1024

export type RequestLogDirection =
  "meta_to_resender" | "resender_to_bot" | "bot_to_resender"

export type RequestLogStatus = "success" | "failed" | "retrying" | "skipped"

/** Lo que se copia de la conexión: la fila no lleva FK (ver la 0028). */
export type LogAccount = {
  id: string
  tenantId: string
  clientAccountId: string | null
  channel: PageChannel
  metaPageId: string
  name: string
  username: string | null
  whatsappPhoneE164?: string | null
}

export type SerializedBody = { text: string | null; truncated: boolean }

/**
 * Deja un cuerpo listo para la columna de texto. Un string se guarda tal cual
 * (es lo que viajó por el cable); cualquier otra cosa se serializa. Puro.
 */
export function serializeBody(value: unknown): SerializedBody {
  if (value === undefined || value === null) {
    return { text: null, truncated: false }
  }
  let text: string
  if (typeof value === "string") {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  if (text.length === 0) return { text: null, truncated: false }
  return text.length > REQUEST_LOG_BODY_LIMIT
    ? { text: text.slice(0, REQUEST_LOG_BODY_LIMIT), truncated: true }
    : { text, truncated: false }
}

type RequestLogEntry = {
  tenantId: string
  direction: RequestLogDirection
  status: RequestLogStatus
  channel: PageChannel
  eventType: string
  method?: string
  endpoint: string
  httpStatus?: number | null
  durationMs?: number | null
  account?: LogAccount | null
  eventId?: string | null
  requestId?: string | null
  messageId?: string | null
  instagramCommentId?: string | null
  conversationId?: string | null
  providerMessageId?: string | null
  contactId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  skipReason?: string | null
  requestBody?: unknown
  responseBody?: unknown
}

async function guarded(
  direction: RequestLogDirection,
  tenantId: string | undefined,
  write: () => Promise<unknown>
): Promise<void> {
  try {
    await write()
  } catch (error) {
    log({
      entrypoint: "after",
      action: "request_log_write",
      outcome: "failed",
      reason: "internal_error",
      ...(tenantId ? { tenantId } : {}),
      errorMessage: `${direction}: ${describeError(error)}`,
    })
  }
}

async function insertRequestLog(entry: RequestLogEntry): Promise<void> {
  const sql = getSql()
  const request = serializeBody(entry.requestBody)
  const response = serializeBody(entry.responseBody)
  const account = entry.account ?? null
  await sql`
    insert into request_logs (
      tenant_id, direction, status, channel, event_type, method, endpoint,
      http_status, duration_ms,
      connected_page_id, client_account_id, account_name, account_external_id,
      event_id, request_id, message_id, instagram_comment_id, conversation_id,
      provider_message_id, contact_id,
      error_code, error_message, skip_reason,
      request_body, response_body, request_truncated, response_truncated
    )
    values (
      ${entry.tenantId}, ${entry.direction}, ${entry.status}, ${entry.channel},
      ${entry.eventType}, ${entry.method ?? "POST"}, ${entry.endpoint},
      ${entry.httpStatus ?? null}, ${entry.durationMs ?? null},
      ${account?.id ?? null}, ${account?.clientAccountId ?? null},
      ${account ? formatAccountShortLabel(account) : null},
      ${account?.metaPageId ?? null},
      ${entry.eventId ?? null}, ${entry.requestId ?? null},
      ${entry.messageId ?? null}, ${entry.instagramCommentId ?? null},
      ${entry.conversationId ?? null}, ${entry.providerMessageId ?? null},
      ${entry.contactId ?? null},
      ${entry.errorCode ?? null}, ${entry.errorMessage ?? null},
      ${entry.skipReason ?? null},
      ${request.text}, ${response.text}, ${request.truncated},
      ${response.truncated}
    )
  `
}

// ---------------------------------------------------------------------------
// Meta → Resender
// ---------------------------------------------------------------------------

/**
 * Qué pasó con el evento, para el bloque «resultado del procesamiento». Un
 * reintento de Meta ya procesado es `skipped`: llegó bien y no había nada que
 * hacer. No hay `failed` por evento: si la ingesta lanza, no hay fila que
 * atribuir (queda en Workers Logs, como hasta ahora).
 */
export type InboundLogResult =
  | { kind: "ingested"; forwarding: string }
  | { kind: "status_applied"; deliveryStatus: string }
  | { kind: "duplicate" }

export function logInboundEvent(input: {
  account: LogAccount
  route: string
  requestId: string
  eventType: string
  result: InboundLogResult
  startedAt: number
  /** El fragmento crudo de Meta, o el evento normalizado si no se encontró. */
  payload: unknown
  messageId?: string | null
  instagramCommentId?: string | null
  conversationId?: string | null
  providerMessageId?: string | null
  contactId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const { account, result } = input
  return guarded("meta_to_resender", account.tenantId, () =>
    insertRequestLog({
      tenantId: account.tenantId,
      direction: "meta_to_resender",
      // Un acuse `failed` de WhatsApp se recibió bien, pero lo que cuenta es que
      // el mensaje no llegó: va como `failed` para que aparezca donde el tenant
      // lo va a buscar, con el motivo de Meta en `error_message`.
      status:
        result.kind === "status_applied" && result.deliveryStatus === "failed"
          ? "failed"
          : result.kind === "duplicate"
            ? "skipped"
            : "success",
      channel: account.channel,
      eventType: input.eventType,
      endpoint: input.route,
      // A Meta siempre se le contesta 200; lo que varía es qué hicimos después.
      httpStatus: 200,
      durationMs: Date.now() - input.startedAt,
      account,
      requestId: input.requestId,
      messageId: input.messageId,
      instagramCommentId: input.instagramCommentId,
      conversationId: input.conversationId,
      providerMessageId: input.providerMessageId,
      contactId: input.contactId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      skipReason: result.kind === "duplicate" ? "duplicate" : null,
      requestBody: input.payload,
      responseBody: {
        result: result.kind,
        ...(result.kind === "ingested"
          ? { forwarding: result.forwarding }
          : {}),
        ...(result.kind === "status_applied"
          ? { deliveryStatus: result.deliveryStatus }
          : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.instagramCommentId
          ? { commentId: input.instagramCommentId }
          : {}),
        ...(input.conversationId
          ? { conversationId: input.conversationId }
          : {}),
      },
    })
  )
}

// ---------------------------------------------------------------------------
// Resender → bot
// ---------------------------------------------------------------------------

/**
 * Un intento de entrega. La fila se crea en el primer intento y se pisa en los
 * siguientes: la lista responde «¿llegó o no?» y el detalle cuenta los
 * intentos. La cuenta, la conversación y el contacto salen de un join por
 * `job_id` y no del llamador, porque el consumidor de la cola solo tiene el job.
 */
export function logDeliveryAttempt(input: {
  jobId: string
  tenantId: string
  status: Extract<RequestLogStatus, "success" | "failed" | "retrying">
  httpStatus: number | null
  durationMs: number
  attempt: number
  maxAttempts: number
  retryDelaySeconds: number | null
  signed: boolean
  error: string | null
  requestBody: string
  responseBody: string | null
}): Promise<void> {
  return guarded("resender_to_bot", input.tenantId, async () => {
    const sql = getSql()
    const request = serializeBody(input.requestBody)
    const response = serializeBody(input.responseBody)
    const nextRetryAt =
      input.status === "retrying" && input.retryDelaySeconds !== null
        ? new Date(Date.now() + input.retryDelaySeconds * 1000)
        : null
    await sql`
      insert into request_logs (
        tenant_id, direction, status, channel, event_type, method, endpoint,
        http_status, duration_ms,
        connected_page_id, client_account_id, account_name,
        account_external_id,
        event_id, message_id, instagram_comment_id, conversation_id,
        provider_message_id, contact_id,
        job_id, attempt_count, max_attempts, next_retry_at, signed,
        error_message,
        request_body, response_body, request_truncated, response_truncated
      )
      select
        j.tenant_id, 'resender_to_bot', ${input.status}::text, p.channel,
        case when j.message_id is not null then 'message' else 'comment' end,
        'POST', coalesce(j.webhook_url, ''),
        ${input.httpStatus}::int, ${input.durationMs}::int,
        p.id, p.client_account_id,
        case
          when p.channel = 'instagram' and p.username is not null
            then '@' || p.username
          when p.channel = 'whatsapp' and p.whatsapp_phone_e164 is not null
            then p.whatsapp_phone_e164
          else p.name
        end,
        p.meta_page_id,
        j.event_id, j.message_id, j.instagram_comment_id, m.conversation_id,
        coalesce(m.meta_message_id, c.ig_comment_id),
        coalesce(m.contact_id, c.from_ig_id),
        j.id, ${input.attempt}::int, ${input.maxAttempts}::int,
        ${nextRetryAt}::timestamptz, ${input.signed}::boolean,
        ${input.error}::text,
        ${request.text}::text, ${response.text}::text,
        ${request.truncated}::boolean, ${response.truncated}::boolean
      from external_webhook_jobs j
      left join messages m on m.id = j.message_id
      left join instagram_comments c on c.id = j.instagram_comment_id
      join connected_pages p
        on p.id = coalesce(m.connected_page_id, c.connected_page_id)
      where j.id = ${input.jobId}
      on conflict (job_id) where job_id is not null do update set
        status = excluded.status,
        http_status = excluded.http_status,
        duration_ms = excluded.duration_ms,
        attempt_count = excluded.attempt_count,
        next_retry_at = excluded.next_retry_at,
        signed = excluded.signed,
        error_message = excluded.error_message,
        response_body = excluded.response_body,
        response_truncated = excluded.response_truncated,
        updated_at = now()
    `
  })
}

/** La cola agotó sus reintentos y el job pasó por la DLQ: la entrega murió. */
export function logDeliveryDead(jobId: string, error: string): Promise<void> {
  return guarded("resender_to_bot", undefined, async () => {
    const sql = getSql()
    await sql`
      update request_logs
      set status = 'failed', next_retry_at = null, error_message = ${error},
        updated_at = now()
      where job_id = ${jobId} and status <> 'success'
    `
  })
}

/**
 * Una entrega que nunca tuvo job: el entrante se omitió a propósito (sin
 * webhook, pausa de reenvío, cuenta restringida) o la URL guardada no sirve.
 * Misma fila que un intento, sin `job_id`; la cuenta sale del sujeto.
 */
export function logDeliveryOutcome(input: {
  subject: DeliverySubject
  status: Extract<RequestLogStatus, "skipped" | "failed">
  webhookUrl: string | null
  eventId: string
  skipReason?: string | null
  error?: string | null
  requestId?: string | null
  requestBody?: unknown
}): Promise<void> {
  return guarded("resender_to_bot", undefined, async () => {
    const sql = getSql()
    const request = serializeBody(input.requestBody)
    const messageId = input.subject.kind === "message" ? input.subject.id : null
    const commentId = input.subject.kind === "comment" ? input.subject.id : null
    // Los parámetros van casteados: en un `insert … select` Postgres no les
    // presta el tipo de la columna destino, como sí hace en un `values`.
    // Un solo `select` para los dos sujetos, sin componer fragmentos (el driver
    // HTTP de Neon no los soporta): `columna = NULL` nunca es verdadero, así
    // que el sujeto que no es se descarta solo.
    await sql`
      insert into request_logs (
        tenant_id, direction, status, channel, event_type, method, endpoint,
        connected_page_id, client_account_id, account_name,
        account_external_id,
        event_id, request_id, message_id, instagram_comment_id,
        conversation_id, provider_message_id, contact_id,
        attempt_count, error_message, skip_reason,
        request_body, request_truncated
      )
      select
        p.tenant_id, 'resender_to_bot', ${input.status}::text, p.channel,
        ${input.subject.kind}::text, 'POST', ${input.webhookUrl ?? ""}::text,
        p.id, p.client_account_id,
        case
          when p.channel = 'instagram' and p.username is not null
            then '@' || p.username
          when p.channel = 'whatsapp' and p.whatsapp_phone_e164 is not null
            then p.whatsapp_phone_e164
          else p.name
        end,
        p.meta_page_id,
        ${input.eventId}::text, ${input.requestId ?? null}::text, m.id, c.id,
        m.conversation_id,
        coalesce(m.meta_message_id, c.ig_comment_id),
        coalesce(m.contact_id, c.from_ig_id),
        0, ${input.error ?? null}::text, ${input.skipReason ?? null}::text,
        ${request.text}::text, ${request.truncated}::boolean
      from connected_pages p
      left join messages m
        on m.id = ${messageId}::uuid and m.connected_page_id = p.id
      left join instagram_comments c
        on c.id = ${commentId}::uuid and c.connected_page_id = p.id
      where m.id is not null or c.id is not null
      limit 1
    `
  })
}

// ---------------------------------------------------------------------------
// Bot → Resender
// ---------------------------------------------------------------------------

export function logApiRequest(input: {
  tenantId: string
  channel: PageChannel
  eventType: string
  method: string
  endpoint: string
  httpStatus: number
  durationMs: number
  requestId: string | null
  account: LogAccount | null
  messageId: string | null
  instagramCommentId: string | null
  conversationId: string | null
  providerMessageId: string | null
  contactId: string | null
  errorCode: string | null
  errorMessage: string | null
  requestBody: string | null
  responseBody: string | null
}): Promise<void> {
  return guarded("bot_to_resender", input.tenantId, () =>
    insertRequestLog({
      ...input,
      direction: "bot_to_resender",
      status:
        input.httpStatus >= 200 && input.httpStatus < 300
          ? "success"
          : "failed",
    })
  )
}

// ---------------------------------------------------------------------------
// Retención
// ---------------------------------------------------------------------------

const PURGE_BATCH_SIZE = 5_000

/**
 * Borra lo que cumplió la retención. Por lotes: el cron corre cada 30 minutos y
 * un `delete` sin tope sobre una tabla que crece con cada webhook puede pasarse
 * del tiempo de la invocación. Lo que no entre en este lote cae en el próximo.
 */
export async function purgeExpiredRequestLogs(): Promise<number> {
  try {
    const sql = getSql()
    const cutoff = new Date(
      Date.now() - REQUEST_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    )
    const rows = await sql`
      delete from request_logs
      where id in (
        select id from request_logs
        where created_at < ${cutoff}
        order by created_at
        limit ${PURGE_BATCH_SIZE}
      )
      returning id
    `
    log({
      entrypoint: "scheduled",
      action: "request_log_purge",
      outcome: "ok",
      count: rows.length,
    })
    return rows.length
  } catch (error) {
    log({
      entrypoint: "scheduled",
      action: "request_log_purge",
      outcome: "failed",
      reason: "internal_error",
      errorMessage: describeError(error),
    })
    return 0
  }
}
