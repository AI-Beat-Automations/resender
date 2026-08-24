// Entrypoint del Worker `web`.
//
// Hasta ahora `wrangler.jsonc` apuntaba `main` directo a `.open-next/worker.js`,
// que **solo exporta `fetch`**. Un Worker de Cloudflare puede exportar además
// `queue` y `scheduled`, pero el bundle que genera OpenNext no los tiene y no
// hay forma de agregárselos desde su config. El patrón documentado por
// `@opennextjs/cloudflare` es este: un entrypoint propio que reexporta el
// `fetch` generado y agrega los handlers al lado.
//
// Por qué hace falta: el reenvío al webhook del tenant vive hoy dentro de
// `after()`, que en Workers es `waitUntil` y tiene un techo **duro de 30
// segundos**. Con eso solo entran los 3 intentos en ~4 s que hace
// `lib/inbound/external-push.ts`; si el endpoint del cliente está caído un
// minuto, el evento se pierde y no hay reintento posible. Una entrega durable
// —reintentos a lo largo de minutos, DLQ, recuperación por cron— no cabe en el
// ciclo de vida de un request, y por eso necesita cola.
//
// El archivo nació vacío a propósito —cambiar `main` es el único cambio capaz
// de tumbar el sitio entero, así que se desplegó y se verificó solo— y hoy
// despacha dos familias de colas: `webhook-deliveries` (entrega al webhook del
// tenant) y `whatsapp-jobs` (media y purgado de R2).
import { default as nextHandler } from "./.open-next/worker.js"

import { recoverPendingMediaPurges } from "./lib/account/media-purge"
import {
  consumeWebhookQueue,
  recoverWebhookJobs,
} from "./lib/inbound/webhook-delivery"
import { consumeWhatsappQueue } from "./lib/jobs/whatsapp-queue"

type WebWorker = {
  fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: WorkerExecutionContext
  ): Promise<Response>
  queue(
    batch: MessageBatch<unknown>,
    env: CloudflareEnv,
    ctx: WorkerExecutionContext
  ): Promise<void>
  scheduled(
    controller: ScheduledController,
    env: CloudflareEnv,
    ctx: WorkerExecutionContext
  ): Promise<void>
}

const worker: WebWorker = {
  // Sin envolver: todo el sitio —páginas, RSC, server actions y los route
  // handlers de `/api/*`— sigue saliendo del bundle de OpenNext exactamente
  // igual que antes. Interponer algo acá sería poner código en el camino de
  // cada request del producto para servir a dos handlers que no lo necesitan.
  fetch: nextHandler.fetch,

  // Un solo handler `queue` para las **cuatro** colas: Cloudflare no permite
  // uno por cola, así que el despacho es por `batch.queue`. Dentro de cada
  // familia, el consumidor distingue además la principal de su DLQ.
  //
  // Las dos familias no comparten nada más que este switch: `webhook-deliveries`
  // lleva el trabajo en Postgres y solo encola un `jobId`, mientras que
  // `whatsapp-jobs` lleva el trabajo en el cuerpo del mensaje.
  async queue(batch, env) {
    if (batch.queue.startsWith("whatsapp-jobs")) {
      await consumeWhatsappQueue(batch, env)
      return
    }

    await consumeWebhookQueue(batch)
  },

  // Reclama los jobs cuyo plazo durable venció: los que quedaron
  // `pending`/`processing` porque el Worker murió entre encolar y entregar. Es
  // la red debajo de la cola, no un segundo camino de entrega.
  //
  // Suma el reclamo de los purgados de R2 que quedaron pendientes: la fila de
  // `pending_media_deletions` sobrevive al borrado de la cuenta justamente para
  // que este cron pueda volver a intentarlo.
  async scheduled(_controller, env) {
    await recoverWebhookJobs(env)
    await recoverPendingMediaPurges(env)
  },
}

export default worker
