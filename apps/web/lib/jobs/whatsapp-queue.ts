import { handleMediaPurgeJob } from "@/lib/account/media-purge"
import { getMediaBucket } from "@/lib/messages/media-access"
import { log } from "@/lib/observability/logger"

import { downloadMediaToR2, markAttachmentFailed } from "./media-download"

// Consumidor de `whatsapp-jobs` y de su DLQ.
//
// Cola propia y no `webhook-deliveries` a propósito: un import de historial de
// Coexistence son miles de jobs, y en la cola de entregas competirían en batches
// de 10 con los pushes de **todos** los tenants. Un cliente conectando su número
// no puede retrasarle las entregas a los demás.
//
// A diferencia de `webhook-deliveries`, acá el **cuerpo del mensaje discrimina**:
// no hay una tabla de jobs que sepa qué hay que hacer, así que el tipo viaja en
// el mensaje. Es una unión y no un `type: string` para que un job nuevo no
// compile hasta que este switch lo atienda.

function parseJob(value: unknown): WhatsappJobMessage | null {
  if (!value || typeof value !== "object") return null
  const type = (value as { type?: unknown }).type
  if (typeof type !== "string") return null
  if (
    type !== "history_sync_request" &&
    type !== "history_chunk" &&
    type !== "media_download" &&
    type !== "media_purge"
  ) {
    return null
  }
  return value as WhatsappJobMessage
}

export async function consumeWhatsappQueue(
  batch: MessageBatch<unknown>,
  env: CloudflareEnv
): Promise<void> {
  // Mismo criterio que el consumidor de entregas: la DLQ se distingue por el
  // nombre de la cola, no por un binding aparte.
  const isDlq = batch.queue.includes("dlq")

  for (const message of batch.messages) {
    const job = parseJob(message.body)

    if (!job) {
      // Un cuerpo que no entendemos no se reintenta: reintentarlo es repetir el
      // mismo fallo cinco veces y terminar igual en la DLQ.
      log({
        entrypoint: "queue",
        action: "queue_consume",
        outcome: "dropped",
        reason: "invalid_queue_payload",
        channel: "whatsapp",
      })
      message.ack()
      continue
    }

    if (isDlq) {
      // La DLQ no vuelve a intentar el trabajo: solo deja constancia. Un medio
      // que agotó los reintentos se marca `failed` para que el mensaje siga
      // existiendo y el webhook del tenant lo reciba con ese estado, en vez de
      // quedarse `pending` para siempre.
      if (job.type === "media_download") {
        await markAttachmentFailed(job.messageId, "queue_retries_exhausted")
      }

      log({
        entrypoint: "queue",
        action: "queue_consume",
        outcome: "dropped",
        reason: "queue_retries_exhausted",
        channel: "whatsapp",
      })
      message.ack()
      continue
    }

    try {
      await runJob(job, env)
      message.ack()
    } catch (error) {
      // Se deja caer para que la cola reintente con su propio backoff. Los
      // fallos definitivos —MIME fuera de catálogo, archivo demasiado grande—
      // no llegan acá: los resuelve el propio job marcando `failed`.
      log({
        entrypoint: "queue",
        action: "queue_consume",
        outcome: "failed",
        reason: "internal_error",
        channel: "whatsapp",
        errorMessage: error instanceof Error ? error.message : undefined,
      })
      message.retry()
    }
  }
}

async function runJob(
  job: WhatsappJobMessage,
  env: CloudflareEnv
): Promise<void> {
  switch (job.type) {
    case "media_download":
      await downloadMediaToR2({
        bucket: getMediaBucket(),
        messageId: job.messageId,
        providerMediaId: job.providerMediaId,
      })
      return

    case "media_purge":
      // Se re-encola a sí mismo con el cursor mientras queden objetos, así que
      // acá no hay bucle: un job procesa una página de 1000 y encola la
      // siguiente.
      await handleMediaPurgeJob({
        env,
        prefix: job.prefix,
        cursor: job.cursor,
      })
      return

    case "history_sync_request":
    case "history_chunk":
      // El historial de Coexistence se pide y se persiste desde el callback y el
      // webhook, que es donde está el contexto de la conexión. Estos dos tipos
      // quedan declarados en la unión —y atendidos acá— para que el día que el
      // trabajo se mueva a la cola no haya que tocar el discriminador.
      log({
        entrypoint: "queue",
        action: "queue_consume",
        outcome: "skipped",
        reason: "job_already_terminal",
        channel: "whatsapp",
      })
      return
  }
}
