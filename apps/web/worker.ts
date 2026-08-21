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

import { log } from "./lib/observability/logger"

type WebWorker = {
  fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: WorkerExecutionContext,
  ): Promise<Response>
  queue(
    batch: MessageBatch<WebhookDeliveryMessage>,
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

  async queue(batch) {
    // Hoy **nada** encola: el binding y los consumidores se declaran en este
    // paso para validar que Cloudflare acepta la config, pero el productor no
    // existe todavía. Por eso cada mensaje se reintenta en lugar de aceptarse:
    // aceptar un mensaje que no se procesó lo borra en silencio, y el silencio
    // es justo el modo de falla que este proyecto no se puede permitir en el
    // camino de entrega.
    for (const message of batch.messages) {
      log({
        entrypoint: "queue",
        action: "queue_consume",
        outcome: "retry",
        reason: "not_implemented",
        level: "error",
        attempt: message.attempts,
      })
      message.retry()
    }
  },

  async scheduled() {
    // La recuperación por cron reclama los jobs cuyo plazo durable venció —los
    // que quedaron `pending`/`processing` porque el Worker se cayó entre encolar
    // y entregar—. Sin productor no hay jobs que reclamar, así que por ahora
    // solo deja constancia de que el trigger está vivo: si esta línea no aparece
    // cada 5 minutos en producción, el cron no quedó configurado y hay que
    // saberlo antes de depender de él.
    log({
      entrypoint: "scheduled",
      action: "delivery_recover",
      outcome: "skipped",
      reason: "not_implemented",
      count: 0,
    })
  },
}

export default worker
