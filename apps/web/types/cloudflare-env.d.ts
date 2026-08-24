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
  // Productor de `whatsapp-jobs`. Cola propia y no `webhook-deliveries` a
  // propósito: un import de historial de Coexistence son miles de jobs, y en la
  // cola de entregas competirían en batches de 10 con los pushes de **todos**
  // los tenants.
  WHATSAPP_JOBS: Queue<WhatsappJobMessage>
  // Bucket R2 privado con la media **entrante** de WhatsApp. La saliente no
  // pasa por acá: la hospeda el cliente y viaja por `link`.
  WHATSAPP_MEDIA: R2Bucket
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

// ---------------------------------------------------------------------------
// Cola de trabajo de WhatsApp.
//
// A diferencia de `WebhookDeliveryMessage`, acá el cuerpo **sí** discrimina: no
// hay una tabla de jobs que sepa qué hay que hacer. Son cuatro trabajos con
// formas distintas y sin estado compartido en Postgres, así que el tipo del
// mensaje es lo único que los distingue y por eso es una unión y no un `type:
// string`: un job nuevo no compila hasta que el consumidor lo atiende.
//
// `history_chunk` lleva el chunk entero porque el webhook responde 200 antes de
// persistirlo; los demás llevan solo ids, y el estado lo leen de la base.
type WhatsappJobMessage =
  // Pide el sync de historial a la SMB App Data API. Es lo que arranca el
  // reloj de 24 h de Coexistence, y si falla la conexión muere en silencio.
  | { type: "history_sync_request"; connectionId: string }
  // Un chunk del historial. Llegan desordenados y por fases.
  | { type: "history_chunk"; connectionId: string; chunk: unknown }
  // Baja un medio entrante de Meta a R2. La URL de Meta dura 5 minutos.
  | { type: "media_download"; messageId: string; providerMediaId: string }
  // Vacía el prefijo R2 de una cuenta ya borrada. Reanudable con cursor.
  | { type: "media_purge"; prefix: string; cursor?: string }

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

// ---------------------------------------------------------------------------
// R2, con el mismo criterio que `Queue` y `RateLimit`: solo la superficie que
// este worker usa de verdad. `get` devuelve un objeto con `body` como stream
// porque la ruta de descarga hace streaming al cliente en vez de cargar el
// archivo entero en memoria — un documento de WhatsApp llega hasta 100 MB.
interface R2Range {
  offset?: number
  length?: number
  suffix?: number
}

interface R2GetOptions {
  range?: R2Range | string
}

interface R2PutOptions {
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
}

interface R2Object {
  readonly key: string
  readonly size: number
  readonly etag: string
  readonly httpMetadata?: { contentType?: string }
  readonly customMetadata?: Record<string, string>
}

interface R2ObjectBody extends R2Object {
  readonly body: ReadableStream
  arrayBuffer(): Promise<ArrayBuffer>
}

interface R2Objects {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
}

interface R2ListOptions {
  prefix?: string
  limit?: number
  cursor?: string
}

interface R2Bucket {
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: R2PutOptions
  ): Promise<R2Object>
  delete(keys: string | string[]): Promise<void>
  list(options?: R2ListOptions): Promise<R2Objects>
}
