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
import * as Sentry from "@sentry/nextjs"

import { default as nextHandler } from "./.open-next/worker.js"

import { recoverPendingMediaPurges } from "./lib/account/media-purge"
import {
  consumeWebhookQueue,
  recoverWebhookJobs,
} from "./lib/inbound/webhook-delivery"
import { consumeWhatsappQueue } from "./lib/jobs/whatsapp-queue"
import { purgeExpiredRequestLogs } from "./lib/logs/request-log"
import {
  type TrackedContext,
  trackWaitUntil,
} from "./lib/observability/request-flush"

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

// Sentry para `queue` y `scheduled`. Estos handlers no pasan por Next, así que
// `instrumentation.ts` no corre para ellos: sin este `init`, `log()` solo
// llegaba a Sentry si el isolate ya había atendido un request.
//
// El DSN sale de `env.SENTRY_DSN` y no de `NEXT_PUBLIC_SENTRY_DSN`: las
// `NEXT_PUBLIC_*` las inlinea `next build` en el bundle de OpenNext, no en este
// archivo, que lo empaqueta wrangler. `deploy.yml` lo pasa con `--var`; staging
// no lo pasa y queda apagado, igual que el resto de Sentry.
//
// Sin tracing: acá solo interesan los logs y los errores, y cada span sería
// trabajo extra en el camino de la entrega.
//
// Si Next ya inicializó el cliente en este isolate, se reusa: el SDK guarda el
// cliente en un global compartido entre las dos copias del paquete.
function initSentry(env: CloudflareEnv) {
  try {
    if (Sentry.getClient()) return
    Sentry.init({
      dsn: env.SENTRY_DSN,
      enabled: env.ENVIRONMENT === "production" && Boolean(env.SENTRY_DSN),
      environment: env.ENVIRONMENT ?? "development",
    })
  } catch {
    // Observabilidad nunca tumba la entrega: sin Sentry, la cola sigue.
  }
}

// El flush va en `waitUntil` y **nunca** con `await` antes de terminar el
// handler: el ack del batch no espera a que Sentry responda. Si Sentry está
// caído, el flush vence solo a los 2 s sin afectar nada.
function flushSentry(ctx: WorkerExecutionContext) {
  try {
    ctx.waitUntil(Sentry.flush(2000).catch(() => false))
  } catch {
    // Ídem `initSentry`.
  }
}

const worker: WebWorker = {
  // Todo el sitio —páginas, RSC, server actions y los route handlers de
  // `/api/*`— sigue saliendo del bundle de OpenNext. La única capa es la del
  // flush de Sentry (`lib/observability/request-flush.ts`): anota las tareas
  // de `waitUntil` del request y, cuando terminaron todas, manda los logs. La
  // respuesta no espera nada de eso.
  //
  // Nada de la capa puede tumbar un request: si armar el contexto falla, el
  // request va a OpenNext con el `ctx` original, exactamente como antes. El
  // `fetch` de OpenNext no se envuelve en `try`: reintentarlo ejecutaría el
  // request dos veces.
  async fetch(request, env, ctx) {
    let tracked: TrackedContext
    try {
      tracked = trackWaitUntil(ctx)
    } catch {
      return nextHandler.fetch(request, env, ctx)
    }

    const response = await nextHandler.fetch(request, env, tracked.ctx)

    try {
      ctx.waitUntil(
        tracked
          .settled()
          .then(() => (Sentry.getClient() ? Sentry.flush(2000) : true))
          .catch(() => false)
      )
    } catch {
      // Ídem `initSentry`: perder los logs de un request es aceptable.
    }
    return response
  },

  // Un solo handler `queue` para las **cuatro** colas: Cloudflare no permite
  // uno por cola, así que el despacho es por `batch.queue`. Dentro de cada
  // familia, el consumidor distingue además la principal de su DLQ.
  //
  // Las dos familias no comparten nada más que este switch: `webhook-deliveries`
  // lleva el trabajo en Postgres y solo encola un `jobId`, mientras que
  // `whatsapp-jobs` lleva el trabajo en el cuerpo del mensaje.
  async queue(batch, env, ctx) {
    initSentry(env)
    try {
      if (batch.queue.startsWith("whatsapp-jobs")) {
        await consumeWhatsappQueue(batch, env)
        return
      }

      await consumeWebhookQueue(batch)
    } finally {
      flushSentry(ctx)
    }
  },

  // Reclama los jobs cuyo plazo durable venció: los que quedaron
  // `pending`/`processing` porque el Worker murió entre encolar y entregar. Es
  // la red debajo de la cola, no un segundo camino de entrega.
  //
  // Suma el reclamo de los purgados de R2 que quedaron pendientes: la fila de
  // `pending_media_deletions` sobrevive al borrado de la cuenta justamente para
  // que este cron pueda volver a intentarlo.
  async scheduled(_controller, env, ctx) {
    initSentry(env)
    try {
      await recoverWebhookJobs(env)
      await recoverPendingMediaPurges(env)
      // Retención de la sección Logs (30 días). No lanza: un barrido fallido se
      // reintenta solo en la próxima corrida.
      await purgeExpiredRequestLogs()
    } finally {
      flushSentry(ctx)
    }
  },
}

export default worker
