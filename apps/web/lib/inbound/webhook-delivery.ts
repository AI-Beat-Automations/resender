import { getCloudflareContext } from "@opennextjs/cloudflare"

import { getSql } from "@/lib/db"
import type { PageChannel } from "@/lib/pages/page-registry"
import { normalizeWebhookUrl } from "@/lib/pages/webhook-url"
import { signedWebhookHeaders } from "@/lib/pages/webhook-signing"
import { accountFields, describeError, log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

import { recordDelivery } from "./external-push"
import type {
  DeliveryLogContext,
  DeliverySubject,
  PushPayload,
} from "./external-push"

// Entrega durable al webhook del tenant.
//
// Reemplaza al bucle de `external-push.ts`, que hacía 3 intentos con esperas de
// 1 s y 3 s **dentro de `after()`**. En Workers `after()` es `waitUntil`, con un
// techo duro de 30 segundos: si el endpoint del cliente estaba caído un minuto,
// el evento se perdía y no había forma de reintentarlo. Para un producto que es
// un relay, esa es la promesa central.
//
// El estado vive en `external_webhook_jobs` (migración 0010, relajada por la
// 0013 para aceptar mensajes **y** comentarios), no en la cola: la cola es solo
// el disparador. Eso es lo que hace que el cron pueda recuperar un job cuyo
// mensaje se perdió, y que un reintento lea el estado actual y no el que existía
// cuando se encoló.

// Cinco intentos repartidos en ~22 minutos, contra los ~4 segundos de antes. La
// curva es la del `apps/api` que diseñó esto: corta al principio para el
// endpoint que se reinicia, y larga al final para el que está en mantenimiento.
const QUEUE_RETRY_DELAYS_SECONDS = [5, 30, 120, 300, 900] as const

const WEBHOOK_DELIVERY_TIMEOUT_MS = 5_000

// Cuánto se le da a un job reclamado antes de considerarlo colgado. Si el Worker
// muere entre el `claim` y el `recordJobAttempt`, el job queda en `processing`
// para siempre; pasado este plazo el cron lo devuelve a `pending`.
const RECOVERY_PROCESSING_TIMEOUT_SECONDS = 120

// Margen entre el `send` a la cola y el momento en que el cron se sentiría con
// derecho a reclamar el mismo job. Sin él, un job recién encolado sería
// recuperado por el cron antes de que la cola llegara a entregarlo, y saldrían
// dos entregas del mismo evento.
const RECOVERY_HANDOFF_GRACE_SECONDS = 120

// Mismo margen, aplicado al reintento: el job no es recuperable hasta que su
// propio retardo de cola haya vencido y pasado esta gracia.
const RECOVERY_RETRY_GRACE_SECONDS = 120

const RECOVERY_BATCH_SIZE = 100

// El id del evento es determinista y sale del uuid del sujeto. Podría ser un
// hash del contenido, pero no hace falta: `external_webhook_jobs` ya tiene
// índices únicos parciales por `message_id` y por `instagram_comment_id`, así
// que un sujeto no puede tener dos jobs. Derivarlo del uuid hace que el mismo
// evento reingerido produzca el mismo `event_id`, que es justo lo que un
// consumidor necesita para deduplicar de su lado.
export function eventIdFor(subject: DeliverySubject): string {
  return `evt_${subject.id.replace(/-/g, "")}`
}

function queue(): Queue<WebhookDeliveryMessage> {
  // A diferencia de `lib/waitlist/rate-limit.ts`, acá no se degrada a `null`: un
  // entrante que no se puede encolar es un evento que el tenant no va a recibir,
  // y eso tiene que romper y quedar en el log, no seguir en silencio.
  return getCloudflareContext().env.WEBHOOK_DELIVERIES
}

// ---------------------------------------------------------------------------
// Alta del job
// ---------------------------------------------------------------------------

// Escribe el job y lo encola. Sustituye a `pushInboundEvent`: mismo lugar de
// llamada —`after()`, tras haberle respondido a Meta— pero ahora lo único que
// pasa ahí es un insert y un `send`, no una cadena de fetches con esperas.
//
// El payload se guarda **tal cual lo construyó TypeScript**. `apps/api` lo
// armaba con `jsonb_build_object` en SQL y con otra forma (`{id, type:
// 'message.received', data: {...}}`); la de producción es la de
// `buildInboundPushPayload` (`{type: "message", tenant, page, conversation,
// message}`) y es la que está documentada en CONTEXT.md. Portar el SQL de `api`
// habría cambiado el contrato de todos los tenants sin que nadie lo pidiera.
export async function enqueueDelivery(input: {
  subject: DeliverySubject
  webhookUrl: string
  payload: PushPayload
  context?: DeliveryLogContext
}): Promise<void> {
  const context = input.context ?? {}
  const normalized = normalizeWebhookUrl(input.webhookUrl)
  if (!normalized.ok || !normalized.value) {
    // Una URL inválida no es un fallo transitorio: no se encola, se registra el
    // intento fallido y se termina. Mismo comportamiento que antes.
    const deliveryError = normalized.ok
      ? "webhookUrl not configured"
      : normalized.error
    await recordDelivery({
      subject: input.subject,
      webhookUrl: input.webhookUrl,
      status: "failed",
      statusCode: null,
      error: deliveryError,
      attempt: 1,
    })
    log({
      entrypoint: "after",
      action: "webhook_delivery",
      outcome: "failed",
      reason: "webhook_url_invalid",
      ...context,
      attempt: 1,
      errorMessage: deliveryError,
    })
    await captureDeliveryFailed(input.payload.tenant.id, input.subject, {
      reason: deliveryError,
    })
    return
  }

  const job = await insertJob({
    subject: input.subject,
    eventId: eventIdFor(input.subject),
    tenantId: input.payload.tenant.id,
    webhookUrl: normalized.value,
    payload: input.payload,
  })

  // Un job que ya existía y no está `pending` ya fue entregado o cerrado: esto
  // es Meta reintentando un evento que ya procesamos. Encolarlo otra vez sería
  // una segunda entrega del mismo mensaje.
  if (!job.enqueueable) {
    log({
      entrypoint: "after",
      action: "webhook_delivery",
      outcome: "duplicate",
      reason: "already_ingested",
      ...context,
      jobId: job.id,
    })
    return
  }

  await queue().send({ jobId: job.id })
  log({
    entrypoint: "after",
    action: "webhook_delivery",
    outcome: "ok",
    ...context,
    jobId: job.id,
  })
}

async function insertJob(input: {
  subject: DeliverySubject
  eventId: string
  tenantId: string
  webhookUrl: string
  payload: PushPayload
}): Promise<{ id: string; enqueueable: boolean }> {
  const sql = getSql()
  const messageId = input.subject.kind === "message" ? input.subject.id : null
  const commentId = input.subject.kind === "comment" ? input.subject.id : null
  // `recover_after` arranca en el futuro a propósito: es la ventana en la que la
  // cola tiene la posta y el cron no debe tocar el job.
  const recoverAfter = new Date(
    Date.now() + RECOVERY_HANDOFF_GRACE_SECONDS * 1000
  )

  // `on conflict do nothing` sobre los índices únicos parciales de la 0013. El
  // `select` de abajo cubre el caso en que la fila ya existía: hace falta saber
  // su estado para decidir si se encola o no.
  const inserted = await sql`
    insert into external_webhook_jobs (
      event_id, tenant_id, message_id, instagram_comment_id, webhook_url,
      payload, status, recover_after
    )
    values (
      ${input.eventId}, ${input.tenantId}, ${messageId}, ${commentId},
      ${input.webhookUrl}, ${JSON.stringify(input.payload)}, 'pending',
      ${recoverAfter}
    )
    on conflict do nothing
    returning id
  `
  if (inserted[0]) {
    return { id: String(inserted[0].id), enqueueable: true }
  }

  // Las dos columnas en un solo `where`, sin componer fragmentos: el driver HTTP
  // de Neon no soporta `sql` anidado —eso es idiom de postgres.js— y trataría el
  // fragmento como un parámetro más. Funciona porque `columna = NULL` nunca es
  // verdadero, y exactamente uno de los dos parámetros viene informado: el
  // sujeto que no es se descarta solo.
  const existing = await sql`
    select id, status, attempt_count
    from external_webhook_jobs
    where message_id = ${messageId}::uuid
       or instagram_comment_id = ${commentId}::uuid
    limit 1
  `
  const row = existing[0]
  if (!row) throw new Error("webhook job was neither inserted nor found")
  return {
    id: String(row.id),
    // Solo se reencola un job que quedó `pending` sin haberse intentado nunca:
    // es el caso de un insert que sobrevivió a un Worker que murió antes del
    // `send`. Uno con intentos ya hechos lo maneja la cola o el cron.
    enqueueable: row.status === "pending" && Number(row.attempt_count) === 0,
  }
}

// ---------------------------------------------------------------------------
// Estado del job
// ---------------------------------------------------------------------------

type JobRecord = {
  id: string
  eventId: string
  tenantId: string
  messageId: string | null
  commentId: string | null
  connectionId: string
  channel: PageChannel
  metaPageId: string
  username: string | null
  webhookUrl: string | null
  payload: unknown
  status: "pending" | "processing" | "succeeded" | "failed_permanent" | "dead"
  attemptCount: number
  recoverAfter: Date
  // Nullable a propósito: las conexiones anteriores a la firma no tienen
  // secreto, y su push sigue saliendo sin firmar en vez de dejar de entregarse.
  signingSecretEncrypted: string | null
}

// Los dos joins son `left` y la cuenta sale del que venga informado. Con un join
// interno a `messages`, un job de comentario no devolvía fila y la entrega
// quedaba colgada sin explicación — el mismo error que `apps/api` ya corrigió.
async function getJob(jobId: string): Promise<JobRecord | null> {
  const sql = getSql()
  const rows = await sql`
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

// El `where status = 'pending'` es lo que hace que dos entregas concurrentes del
// mismo job no salgan las dos: la primera cambia el estado y la segunda no
// encuentra fila que actualizar.
async function claimJob(jobId: string): Promise<JobRecord | null> {
  const sql = getSql()
  const recoverAfter = new Date(
    Date.now() + RECOVERY_PROCESSING_TIMEOUT_SECONDS * 1000
  )
  const claimed = await sql`
    update external_webhook_jobs
    set status = 'processing',
      attempt_count = attempt_count + 1,
      recover_after = ${recoverAfter},
      updated_at = now()
    where id = ${jobId} and status = 'pending'
    returning id
  `
  if (!claimed[0]) return null
  return getJob(jobId)
}

async function recordJobAttempt(input: {
  job: JobRecord
  outcome: "succeeded" | "pending" | "failed_permanent"
  statusCode: number | null
  error: string | null
  retryDelaySeconds: number | null
}): Promise<void> {
  const sql = getSql()
  const deliveryStatus = input.outcome === "succeeded" ? "success" : "failed"
  const recoverAfter =
    input.outcome === "pending" && input.retryDelaySeconds !== null
      ? new Date(
          Date.now() +
            (input.retryDelaySeconds + RECOVERY_RETRY_GRACE_SECONDS) * 1000
        )
      : input.job.recoverAfter

  // La bitácora del intento y el estado del job van en la misma transacción: un
  // job marcado `succeeded` sin su fila de entrega dejaría la bitácora mintiendo
  // sobre lo que pasó, que es la tabla que se consulta en el runbook de la DLQ.
  await sql.transaction([
    sql`
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
    sql`
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

// Persistir el estado terminal **es** el traspaso: si esta escritura falla, el
// mensaje de la DLQ tiene que seguir disponible para reintentarse. Por eso lanza
// en vez de resolver, y por eso el consumidor de la DLQ conserva reintentos.
async function markJobDead(jobId: string, error: string): Promise<void> {
  const sql = getSql()
  const rows = await sql`
    update external_webhook_jobs
    set status = 'dead', last_error = ${error}, updated_at = now()
    where id = ${jobId} and status <> 'succeeded'
    returning id
  `
  if (rows[0]) return
  const existing = await getJob(jobId)
  if (existing?.status === "succeeded") return
  throw new Error("webhook job terminal state was not persisted")
}

async function findRecoverableJobs(): Promise<string[]> {
  const sql = getSql()
  const now = new Date()
  const leaseUntil = new Date(
    now.getTime() + RECOVERY_HANDOFF_GRACE_SECONDS * 1000
  )
  // `for update skip locked` para que dos ejecuciones solapadas del cron no
  // reclamen el mismo job. La lease empuja `recover_after` hacia adelante, así
  // que el job no vuelve a salir en la próxima corrida mientras se entrega.
  const rows = await sql`
    with candidates as (
      select id, status
      from external_webhook_jobs
      where status in ('pending', 'processing')
        and recover_after <= ${now}
      order by recover_after asc, id asc
      limit ${RECOVERY_BATCH_SIZE}
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
    returning jobs.id
  `
  return rows.map((row) => String(row.id))
}

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

export type DeliveryOutcome =
  | { kind: "success"; statusCode: number }
  | { kind: "retry"; statusCode: number | null; error: string }
  | { kind: "permanent"; statusCode: number | null; error: string }

// Misma política que tenía `attemptPush`: 408, 429 y 5xx se reintentan; el resto
// de los 4xx no. Un 404 del endpoint del tenant no mejora reintentándolo.
export function classifyDeliveryResponse(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) {
    return { kind: "success", statusCode: status }
  }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      kind: "retry",
      statusCode: status,
      error: `Webhook responded with HTTP ${status}.`,
    }
  }
  return {
    kind: "permanent",
    statusCode: status,
    error: `Webhook responded with HTTP ${status}.`,
  }
}

export function retryDelaySeconds(attempt: number): number {
  return (
    QUEUE_RETRY_DELAYS_SECONDS[
      Math.min(Math.max(0, attempt - 1), QUEUE_RETRY_DELAYS_SECONDS.length - 1)
    ] ?? 900
  )
}

export async function deliverJob(input: {
  jobId: string
  fetcher?: typeof fetch
}): Promise<{ disposition: "ack" | "retry"; delaySeconds?: number }> {
  const claimed = await claimJob(input.jobId)
  if (!claimed) {
    const existing = await getJob(input.jobId)
    if (
      !existing ||
      existing.status === "succeeded" ||
      existing.status === "failed_permanent" ||
      existing.status === "dead"
    ) {
      // El job ya está cerrado —o no existe— y la entrega no ocurre. Sin esta
      // línea, un job que nadie entregó se ve igual que uno entregado.
      log({
        entrypoint: "queue",
        action: "webhook_delivery",
        outcome: "dropped",
        reason: "job_already_terminal",
        jobId: input.jobId,
        ...(existing ? { tenantId: existing.tenantId } : { status: 404 }),
      })
      return { disposition: "ack" }
    }
    // Está `processing`: otra invocación lo tiene reclamado. Se reintenta más
    // tarde en vez de competir.
    return {
      disposition: "retry",
      delaySeconds: retryDelaySeconds(existing.attemptCount),
    }
  }

  let outcome: DeliveryOutcome
  try {
    if (!claimed.webhookUrl) throw new Error("webhookUrl not configured")
    const body = JSON.stringify(claimed.payload)
    const response = await (input.fetcher ?? fetch)(claimed.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Las tres cabeceras de firma son **aditivas** y solo salen si la
        // conexión tiene secreto. Una conexión anterior a la firma sigue
        // recibiendo exactamente lo que recibía; dejar de entregarle porque le
        // falta un secreto que nunca se le pidió sería romperle el producto para
        // mejorarle la seguridad.
        ...(claimed.signingSecretEncrypted
          ? signedWebhookHeaders({
              encryptedSecret: claimed.signingSecretEncrypted,
              eventId: claimed.eventId,
              body,
            })
          : {}),
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
    })
    outcome = classifyDeliveryResponse(response.status)
  } catch (error) {
    const message = describeError(error)
    outcome =
      message.includes("not configured") || message.includes("must use https")
        ? { kind: "permanent", statusCode: null, error: message }
        : { kind: "retry", statusCode: null, error: message }
  }

  const delaySeconds =
    outcome.kind === "retry" ? retryDelaySeconds(claimed.attemptCount) : null
  await recordJobAttempt({
    job: claimed,
    outcome:
      outcome.kind === "success"
        ? "succeeded"
        : outcome.kind === "permanent"
          ? "failed_permanent"
          : "pending",
    statusCode: outcome.statusCode,
    error: outcome.kind === "success" ? null : outcome.error,
    retryDelaySeconds: delaySeconds,
  })

  log({
    entrypoint: "queue",
    action: "webhook_delivery",
    // Un `permanent` es un 4xx del endpoint del tenant: no se reintenta y es un
    // fallo. Un `retry` todavía tiene intentos por delante, así que va en `warn`
    // por el mapa de niveles y no como error.
    ...(outcome.kind === "success"
      ? { outcome: "ok" as const }
      : {
          outcome:
            outcome.kind === "permanent"
              ? ("failed" as const)
              : ("retry" as const),
          reason:
            outcome.statusCode === null
              ? ("network_error" as const)
              : ("http_error" as const),
        }),
    ...accountFields({
      id: claimed.connectionId,
      tenantId: claimed.tenantId,
      channel: claimed.channel,
      metaPageId: claimed.metaPageId,
      username: claimed.username,
    }),
    jobId: claimed.id,
    ...subjectFields(claimed),
    attempt: claimed.attemptCount,
    status: outcome.statusCode ?? undefined,
  })

  if (outcome.kind === "permanent") {
    await captureDeliveryFailed(claimed.tenantId, subjectOf(claimed), {
      reason: outcome.error,
    })
  }

  return outcome.kind === "retry"
    ? { disposition: "retry", delaySeconds: delaySeconds ?? undefined }
    : { disposition: "ack" }
}

// ---------------------------------------------------------------------------
// Puntos de entrada del Worker
// ---------------------------------------------------------------------------

// El cuerpo entra como `unknown` a propósito, aunque el productor sea nuestro:
// en la cola puede haber mensajes encolados por una versión anterior del Worker,
// y `parseJobId` es la única fuente de verdad sobre si un mensaje es procesable.
// Tiparlo como `WebhookDeliveryMessage` sería afirmar algo que el runtime no
// garantiza.
export async function consumeWebhookQueue(
  batch: MessageBatch<unknown>
): Promise<void> {
  const isDlq = batch.queue.includes("dlq")
  await Promise.all(
    batch.messages.map(async (message) => {
      const jobId = parseJobId(message.body)
      if (!jobId) {
        // No se reintenta: un cuerpo que no parsea no va a parsear en el
        // siguiente intento. Se acepta y queda el log, que es lo único
        // accionable.
        log({
          entrypoint: "queue",
          action: "queue_consume",
          outcome: "failed",
          reason: "invalid_queue_payload",
          // El id del mensaje **de la cola**, que no es el id de un mensaje de
          // Resender.
          queueMessageId: message.id,
        })
        message.ack()
        return
      }

      if (isDlq) {
        try {
          await markJobDead(jobId, "Cloudflare Queue retries exhausted")
          log({
            entrypoint: "queue",
            action: "webhook_delivery",
            outcome: "dead",
            reason: "queue_retries_exhausted",
            jobId,
            queueMessageId: message.id,
          })
          message.ack()
        } catch {
          log({
            entrypoint: "queue",
            action: "queue_consume",
            outcome: "failed",
            reason: "dlq_persist_failed",
            jobId,
            queueMessageId: message.id,
          })
          message.retry({ delaySeconds: retryDelaySeconds(message.attempts) })
        }
        return
      }

      try {
        const result = await deliverJob({ jobId })
        if (result.disposition === "retry") {
          message.retry({ delaySeconds: result.delaySeconds })
        } else {
          message.ack()
        }
      } catch (error) {
        log({
          entrypoint: "queue",
          action: "queue_consume",
          outcome: "failed",
          reason: "internal_error",
          jobId,
          queueMessageId: message.id,
          errorMessage: describeError(error),
        })
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) })
      }
    })
  )
}

// La red debajo de la cola, no un segundo camino de entrega: solo reencola jobs
// cuyo plazo ya venció. Un job sano nunca pasa por acá.
export async function recoverWebhookJobs(
  env: CloudflareEnv
): Promise<number> {
  const jobIds = await findRecoverableJobs()
  await Promise.all(
    jobIds.map((jobId) => env.WEBHOOK_DELIVERIES.send({ jobId }))
  )
  log({
    entrypoint: "scheduled",
    action: "delivery_recover",
    outcome: "ok",
    count: jobIds.length,
  })
  return jobIds.length
}

// ---------------------------------------------------------------------------

function parseJobId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const jobId = (value as Record<string, unknown>).jobId
  return typeof jobId === "string" && jobId ? jobId : null
}

function subjectOf(job: JobRecord): DeliverySubject | null {
  if (job.commentId) return { kind: "comment", id: job.commentId }
  if (job.messageId) return { kind: "message", id: job.messageId }
  return null
}

// El sujeto es un mensaje **o** un comentario desde la 0013; el job sabe de cuál
// cuelga y acá se nombra el que corresponda, para que las métricas de comentarios
// y de mensajes no se mezclen.
function subjectFields(job: JobRecord) {
  const subject = subjectOf(job)
  return subject ? { subject: subject.kind, subjectId: subject.id } : {}
}

async function captureDeliveryFailed(
  tenantId: string,
  subject: DeliverySubject | null,
  properties: Record<string, unknown>
) {
  if (!posthog) return
  posthog.capture({
    distinctId: tenantId,
    event: "message delivery failed",
    properties: {
      ...properties,
      // Las propiedades nombran el sujeto real: mandar el id de un comentario
      // bajo `message_id` mezclaría dos cosas distintas en las métricas.
      ...(subject?.kind === "comment"
        ? { instagram_comment_id: subject.id }
        : subject
          ? { message_id: subject.id }
          : {}),
    },
  })
  await posthog.flush()
}

// `== null` cubre null **y** undefined a propósito. Con `=== null`, una columna
// ausente —una fila vieja, un `select` al que le falta un campo— se convertía en
// el string `"undefined"`, que es truthy: el secreto de firma inexistente pasaba
// a `decryptSecret` y reventaba la entrega en vez de salir sin firmar.
function nullableText(value: unknown): string | null {
  return value == null ? null : String(value)
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    tenantId: String(row.tenant_id),
    messageId: nullableText(row.message_id),
    commentId: nullableText(row.instagram_comment_id),
    connectionId: String(row.connected_page_id),
    channel: row.channel as PageChannel,
    metaPageId: String(row.meta_page_id),
    username: nullableText(row.username),
    webhookUrl: nullableText(row.webhook_url),
    payload: row.payload,
    status: row.status as JobRecord["status"],
    attemptCount: Number(row.attempt_count),
    recoverAfter: new Date(String(row.recover_after)),
    signingSecretEncrypted: nullableText(row.webhook_signing_secret_encrypted),
  }
}
