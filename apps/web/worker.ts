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
// Este archivo llega vacío a propósito. Cambiar `main` es el único cambio de
// este paso que puede tumbar el sitio entero, así que se despliega y se verifica
// solo, antes de meterle lógica de entrega encima. Los handlers se completan en
// el paso siguiente.
import { default as nextHandler } from "./.open-next/worker.js"

import {
  consumeWebhookQueue,
  recoverWebhookJobs,
} from "./lib/inbound/webhook-delivery"

type WebWorker = {
  fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: WorkerExecutionContext,
  ): Promise<Response>
  queue(
    batch: MessageBatch<unknown>,
    env: CloudflareEnv,
    ctx: WorkerExecutionContext,
  ): Promise<void>
  scheduled(
    controller: ScheduledController,
    env: CloudflareEnv,
    ctx: WorkerExecutionContext,
  ): Promise<void>
}

const worker: WebWorker = {
  // Sin envolver: todo el sitio —páginas, RSC, server actions y los route
  // handlers de `/api/*`— sigue saliendo del bundle de OpenNext exactamente
  // igual que antes. Interponer algo acá sería poner código en el camino de
  // cada request del producto para servir a dos handlers que no lo necesitan.
  fetch: nextHandler.fetch,

  // Atiende la cola principal y su DLQ: el mismo consumidor, que se comporta
  // distinto según `batch.queue`. En la principal entrega; en la DLQ solo marca
  // el job `dead` y nunca llama al webhook del cliente.
  async queue(batch) {
    await consumeWebhookQueue(batch)
  },

  // Reclama los jobs cuyo plazo durable venció: los que quedaron
  // `pending`/`processing` porque el Worker murió entre encolar y entregar. Es
  // la red debajo de la cola, no un segundo camino de entrega.
  async scheduled(_controller, env) {
    await recoverWebhookJobs(env)
  },
}

export default worker
