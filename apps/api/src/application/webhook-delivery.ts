import {
  QUEUE_RETRY_DELAYS_SECONDS,
  RECOVERY_BATCH_SIZE,
  RECOVERY_HANDOFF_GRACE_SECONDS,
  RECOVERY_PROCESSING_TIMEOUT_SECONDS,
  RECOVERY_RETRY_GRACE_SECONDS,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
} from "../config"
import { decryptSecret, hmacHex } from "../infrastructure/crypto/secrets"
import type { JobRecord, SqlRepository } from "../infrastructure/db/repository"
import { assertPublicWebhookDestination } from "../infrastructure/http/ssrf"
import { accountFields, describeError, log } from "../observability/logger"
import type { QueuePayload } from "./service"

export type DeliveryOutcome =
  | { kind: "success"; statusCode: number }
  | { kind: "retry"; statusCode: number | null; error: string }
  | { kind: "permanent"; statusCode: number | null; error: string }

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

export async function signedWebhookRequest(input: {
  job: JobRecord
  encryptionKey: string
  fetcher?: typeof fetch
  now?: Date
}): Promise<{ request: Request; rawBody: string }> {
  if (!input.job.webhookUrl) throw new Error("webhook URL is not configured")
  if (!input.job.signingSecretEncrypted) {
    throw new Error("webhook signing secret is not configured")
  }
  await assertPublicWebhookDestination(input.job.webhookUrl)
  const rawBody = JSON.stringify(input.job.payload)
  const timestamp = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const signature = await hmacHex(
    decryptSecret(input.encryptionKey, input.job.signingSecretEncrypted),
    `${input.job.eventId}.${timestamp}.${rawBody}`
  )
  return {
    rawBody,
    request: new Request(input.job.webhookUrl, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "user-agent": "Resender-Webhooks/1.0",
        "resender-event-id": input.job.eventId,
        "resender-timestamp": String(timestamp),
        "resender-signature": `v1=${signature}`,
      },
      body: rawBody,
    }),
  }
}

export async function deliverJob(input: {
  repository: SqlRepository
  jobId: string
  encryptionKey: string
  fetcher?: typeof fetch
}): Promise<{ disposition: "ack" | "retry"; delaySeconds?: number }> {
  const claimed = await input.repository.claimJob(
    input.jobId,
    RECOVERY_PROCESSING_TIMEOUT_SECONDS
  )
  if (!claimed) {
    const existing = await input.repository.getJob(input.jobId)
    if (
      !existing ||
      existing.status === "succeeded" ||
      existing.status === "failed_permanent" ||
      existing.status === "dead"
    ) {
      // Camino mudo hasta ahora, y el que más confunde: el job ya está cerrado
      // —o no existe— y la entrega no ocurre. Sin esta línea, un job de
      // comentario que `getJob` no devolvía por el join interno se veía igual
      // que uno entregado.
      log({
        entrypoint: "queue",
        action: "webhook_delivery",
        outcome: "dropped",
        reason: "job_already_terminal",
        jobId: input.jobId,
        tenantId: existing?.tenantId,
        status: existing ? undefined : 404,
      })
      return { disposition: "ack" }
    }
    return {
      disposition: "retry",
      delaySeconds: retryDelay(existing.attemptCount),
    }
  }

  let outcome: DeliveryOutcome
  try {
    const { request } = await signedWebhookRequest({
      job: claimed,
      encryptionKey: input.encryptionKey,
    })
    const response = await (input.fetcher ?? fetch)(request)
    outcome = classifyDeliveryResponse(response.status)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Webhook delivery failed."
    outcome = isConfigurationOrDestinationError(message)
      ? { kind: "permanent", statusCode: null, error: message }
      : { kind: "retry", statusCode: null, error: message }
  }

  const delaySeconds =
    outcome.kind === "retry" ? retryDelay(claimed.attemptCount) : null
  await input.repository.recordJobAttempt({
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
    retryGraceSeconds: RECOVERY_RETRY_GRACE_SECONDS,
  })
  log({
    entrypoint: "queue",
    action: "webhook_delivery",
    // Un `permanent` es un 4xx del endpoint del tenant: no se reintenta y es un
    // fallo. Un `retry` todavía tiene intentos por delante, así que va en
    // `warn` por el mapa de niveles y no como error.
    ...(outcome.kind === "success"
      ? { outcome: "ok" as const }
      : {
          outcome: outcome.kind === "permanent" ? ("failed" as const) : ("retry" as const),
          reason:
            outcome.statusCode === null
              ? ("network_error" as const)
              : ("http_error" as const),
        }),
    // `claimed.id` es el id del **job**, no el de la conexión: hay que nombrar
    // los campos, no pasar el registro entero.
    ...accountFields({ ...claimed, id: claimed.connectionId }),
    jobId: claimed.id,
    // El sujeto es un mensaje **o** un comentario desde la 0013; el job sabe de
    // cuál cuelga y acá se nombra el que corresponda.
    ...(claimed.commentId
      ? { subject: "comment" as const, subjectId: claimed.commentId }
      : claimed.messageId
        ? { subject: "message" as const, subjectId: claimed.messageId }
        : {}),
    eventId: claimed.eventId,
    attempt: claimed.attemptCount,
    status: outcome.statusCode ?? undefined,
  })
  return outcome.kind === "retry"
    ? {
        disposition: "retry",
        delaySeconds: delaySeconds ?? undefined,
      }
    : { disposition: "ack" }
}

export async function consumeWebhookQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  repository: SqlRepository
): Promise<void> {
  const isDlq = batch.queue.includes("dlq")
  await Promise.all(
    batch.messages.map(async (message) => {
      const payload = parseQueuePayload(message.body)
      if (!payload) {
        log({
          entrypoint: "queue",
          action: "queue_consume",
          outcome: "failed",
          reason: "invalid_queue_payload",
          queue: batch.queue,
          // El id del mensaje **de la cola**, que no es el id de un mensaje de
          // Resender. Antes los dos viajaban bajo `messageId`.
          queueMessageId: message.id,
        })
        message.ack()
        return
      }
      if (isDlq) {
        try {
          // Persisting the terminal state is the handoff boundary. A transient
          // database failure must leave the DLQ message available for retry.
          await repository.markJobDead(
            payload.jobId,
            "Cloudflare Queue retries exhausted"
          )
          log({
            entrypoint: "queue",
            action: "webhook_delivery",
            outcome: "dead",
            reason: "queue_retries_exhausted",
            queue: batch.queue,
            jobId: payload.jobId,
            queueMessageId: message.id,
            ...(payload.commentId
              ? { subject: "comment" as const, subjectId: payload.commentId }
              : payload.messageId
                ? { subject: "message" as const, subjectId: payload.messageId }
                : {}),
          })
          message.ack()
        } catch {
          log({
            entrypoint: "queue",
            action: "queue_consume",
            outcome: "failed",
            reason: "dlq_persist_failed",
            queue: batch.queue,
            jobId: payload.jobId,
            queueMessageId: message.id,
            errorCode: "internal_error",
          })
          message.retry({ delaySeconds: retryDelay(message.attempts) })
        }
        return
      }
      try {
        const result = await deliverJob({
          repository,
          jobId: payload.jobId,
          encryptionKey: env.TOKEN_ENCRYPTION_KEY,
        })
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
          queue: batch.queue,
          jobId: payload.jobId,
          queueMessageId: message.id,
          // Antes este `catch` descartaba el error entero y solo dejaba
          // `internal_error`: la causa quedaba afuera del log justo en el
          // camino donde no hay nadie mirando.
          errorMessage: describeError(error),
          errorCode: "internal_error",
        })
        message.retry({ delaySeconds: retryDelay(message.attempts) })
      }
    })
  )
}

export async function recoverWebhookJobs(
  env: Env,
  repository: SqlRepository
): Promise<number> {
  const jobs = await repository.findRecoverableJobs({
    limit: RECOVERY_BATCH_SIZE,
    leaseSeconds: RECOVERY_HANDOFF_GRACE_SECONDS,
  })
  await Promise.all(
    jobs.map((job) =>
      env.WEBHOOK_DELIVERIES.send({
        jobId: job.jobId,
        ...(job.messageId ? { messageId: job.messageId } : {}),
        ...(job.commentId ? { commentId: job.commentId } : {}),
      } satisfies QueuePayload)
    )
  )
  return jobs.length
}

// El sujeto pasó a ser opcional en el payload de la cola. Lo único que la
// entrega necesita es el `jobId` —el job sabe de qué cuelga—, y `messageId` /
// `commentId` viajan solo como contexto de log.
//
// Exigir `messageId` como antes habría descartado en silencio todos los jobs de
// comentario; aflojarlo, en cambio, deja que los mensajes que ya estaban en
// vuelo al desplegar sigan parseando igual.
function parseQueuePayload(value: unknown): QueuePayload | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.jobId !== "string") return null
  return {
    jobId: record.jobId,
    ...(typeof record.messageId === "string"
      ? { messageId: record.messageId }
      : {}),
    ...(typeof record.commentId === "string"
      ? { commentId: record.commentId }
      : {}),
  }
}

function retryDelay(attempt: number): number {
  return (
    QUEUE_RETRY_DELAYS_SECONDS[
      Math.min(Math.max(0, attempt - 1), QUEUE_RETRY_DELAYS_SECONDS.length - 1)
    ] ?? 900
  )
}

function isConfigurationOrDestinationError(message: string): boolean {
  return (
    message.includes("not configured") ||
    message.includes("not allowed") ||
    message.includes("private address") ||
    message.includes("must use HTTPS")
  )
}
