// Log estructurado del worker `api`. Es el gemelo de
// `apps/web/lib/observability/logger.ts` y los dos esquemas se mantienen
// alineados a propósito: los dos workers atienden los mismos webhooks y una
// investigación cruza de uno al otro, así que un campo que se llame distinto
// obliga a escribir dos consultas para la misma pregunta.
//
// La regla que ordena el módulo: **ningún camino puede terminar en silencio**.
// Por eso `reason` es obligatorio en el tipo cuando el resultado no es `ok`.

type LogLevel = "info" | "warn" | "error"

type Channel = "messenger" | "instagram"

export type LogEntrypoint = "fetch" | "rpc" | "queue" | "scheduled"

export type LogAction =
  // superficie HTTP y RPC
  | "request"
  | "rpc"
  // entrada
  | "webhook_verify"
  | "webhook_receive"
  | "inbound_ingest"
  // entrega al webhook del tenant
  | "webhook_delivery"
  | "queue_consume"
  | "job_recovery"

export type LogOutcome =
  | "ok"
  | "dropped"
  | "duplicate"
  | "skipped"
  | "retry"
  | "failed"
  | "dead"

export type LogReason =
  // verificación y recepción
  | "verify_token_mismatch"
  | "missing_signature"
  | "signature_mismatch"
  | "invalid_json"
  // ingesta
  | "account_not_connected"
  | "no_active_subscription"
  | "already_ingested"
  | "self_authored_comment"
  | "own_published_comment"
  // entrega y cola
  | "http_error"
  | "network_error"
  | "job_already_terminal"
  | "invalid_queue_payload"
  | "queue_retries_exhausted"
  | "dlq_persist_failed"
  // genéricos
  | "internal_error"

type BaseFields = {
  entrypoint: LogEntrypoint
  action: LogAction
  // Nombre del método RPC (`change_password`, `verify_checkout_session`…). Va
  // como campo y no adentro de `action`: mantiene cerrada la unión de acciones
  // y hace que «todo el RPC» sea un solo filtro.
  operation?: string
  requestId?: string
  // cuenta
  tenantId?: string
  connectionId?: string
  channel?: Channel
  accountId?: string
  accountHandle?: string
  // sujeto
  subject?: "message" | "comment"
  subjectId?: string
  providerId?: string
  eventId?: string
  jobId?: string
  // El id del mensaje **de la cola de Cloudflare**, que no es el id de un
  // mensaje de Resender. Antes los dos viajaban bajo `messageId` y son dos
  // entidades distintas; separarlos es el punto.
  queueMessageId?: string
  queue?: string
  // contexto
  route?: string
  status?: number
  attempt?: number
  count?: number
  durationMs?: number
  errorCode?: string | number
  errorMessage?: string
  level?: LogLevel
}

export type LogInput =
  | (BaseFields & { outcome: "ok"; reason?: never })
  | (BaseFields & { outcome: Exclude<LogOutcome, "ok">; reason: LogReason })

const LEVEL_BY_OUTCOME: Record<LogOutcome, LogLevel> = {
  ok: "info",
  dropped: "info",
  duplicate: "info",
  skipped: "info",
  retry: "warn",
  failed: "error",
  dead: "error",
}

// Segunda línea de defensa detrás del tipo, idéntica a la de `web`.
const SECRET_PATTERNS: RegExp[] = [
  /\b(access_token|client_secret|appsecret_proof|verify_token|code)=[^\s&"']+/gi,
  /\bsha256=[0-9a-f]{64}\b/gi,
  /\bEA[A-Za-z0-9]{40,}\b/g,
  /\bIG[A-Za-z0-9]{40,}\b/g,
  /\b[sr]k_(live|test)_[A-Za-z0-9]+\b/g,
  /\bpk_live_[A-Za-z0-9]+\b/g,
]

const MAX_ERROR_MESSAGE = 300

function scrub(value: string) {
  let out = value
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    out = out.replace(pattern, "[redacted]")
  }
  return out.length > MAX_ERROR_MESSAGE
    ? `${out.slice(0, MAX_ERROR_MESSAGE)}…`
    : out
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "unknown error"
}

export function log(input: LogInput) {
  const { level, errorMessage, ...fields } = input
  const record = {
    worker: "api" as const,
    event: `${input.action}_${input.outcome}`,
    ...fields,
    ...(errorMessage ? { errorMessage: scrub(errorMessage) } : {}),
  }

  const resolved = level ?? LEVEL_BY_OUTCOME[input.outcome]
  if (resolved === "error") {
    console.error(record)
    return
  }
  if (resolved === "warn") {
    console.warn(record)
    return
  }
  console.log(record)
}

// Proyecta una cuenta conectada a los campos de cuenta del log, para que
// «cuenta» esté completa o ausente y nunca a medias. `providerPageId` es el
// nombre que usa este worker para lo que en la base es `meta_page_id`.
export function accountFields(page: {
  id: string
  tenantId: string
  channel: Channel
  providerPageId: string
  username?: string | null
}) {
  return {
    tenantId: page.tenantId,
    connectionId: page.id,
    channel: page.channel,
    accountId: page.providerPageId,
    ...(page.username ? { accountHandle: page.username } : {}),
  }
}
