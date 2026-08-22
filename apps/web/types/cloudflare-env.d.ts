// Tipado del binding `ratelimits` declarado en `wrangler.jsonc`, para que
// `getCloudflareContext().env.WAITLIST_RATE_LIMITER` typechequee
// (`lib/waitlist/rate-limit.ts`, ADR 0007).
//
// Está escrito a mano y NO generado con `npm run cf-typegen`. El generador
// escribe `cloudflare-env.d.ts` en la raíz de la app con las ~14.700 líneas de
// tipos del runtime de workerd, y esos globals pisan los del DOM: `Response.json()`
// pasa a devolver `unknown` y `lib/meta.ts` deja de compilar con siete errores
// TS18046. Como la app corre sobre Next (no es un Worker escrito a mano como
// `apps/api`, que sí puede commitear su `worker-configuration.d.ts`), acá solo
// hace falta la forma del binding.
//
// Si algún día se corre `cf-typegen`, este archivo sobra: borralo y arreglá los
// call sites de `lib/meta.ts` en la misma entrega.

// Interfaz que `@opennextjs/cloudflare` declara global y que se amplía por
// merging, igual que `types/next-auth.d.ts` amplía `Session`.
interface CloudflareEnv {
  WAITLIST_RATE_LIMITER: RateLimit
  // Productor de la cola de entregas. La ingesta escribe el job en
  // `external_webhook_jobs` y encola su id; el consumidor vive en `worker.ts`.
  WEBHOOK_DELIVERIES: Queue<WebhookDeliveryMessage>
}

// Mismo nombre y forma que genera `wrangler types`, para que sustituir este
// archivo por el generado no obligue a tocar los call sites.
interface RateLimitOptions {
  key: string
}

interface RateLimitOutcome {
  success: boolean
}

interface RateLimit {
  limit(options: RateLimitOptions): Promise<RateLimitOutcome>
}

// ---------------------------------------------------------------------------
// Cola de entregas al webhook del tenant.
//
// Mismo criterio que `RateLimit` de arriba y por la misma razón: correr
// `cf-typegen` traería los ~14.700 tipos del runtime de workerd, que pisan los
// del DOM y rompen `lib/meta.ts`. Así que acá va solo la forma de lo que este
// worker usa de verdad — `send`, y lo que el consumidor toca de un batch—, no
// la superficie completa de la API de Queues.
//
// El cuerpo del mensaje es **solo el `jobId`**: la fila de `external_webhook_jobs`
// ya sabe de qué cuelga (mensaje o comentario), a qué URL va y con qué payload.
// Meter el payload en el mensaje de la cola sería una segunda copia que puede
// quedar desincronizada de la fila, y el reintento tiene que leer el estado
// actual del job, no el que existía cuando se encoló.
interface WebhookDeliveryMessage {
  jobId: string
}

interface QueueSendOptions {
  delaySeconds?: number
}

interface Queue<Body = unknown> {
  send(body: Body, options?: QueueSendOptions): Promise<void>
}

interface QueueMessage<Body = unknown> {
  readonly id: string
  readonly timestamp: Date
  readonly body: Body
  readonly attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

interface MessageBatch<Body = unknown> {
  // Qué cola disparó el batch. Es lo que distingue la cola principal de su DLQ:
  // el mismo consumidor atiende las dos y se comporta distinto en cada una.
  readonly queue: string
  readonly messages: readonly QueueMessage<Body>[]
  ackAll(): void
  retryAll(options?: { delaySeconds?: number }): void
}

interface ScheduledController {
  readonly cron: string
  readonly scheduledTime: number
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}
