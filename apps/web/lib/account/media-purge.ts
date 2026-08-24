import { getCloudflareContext } from "@opennextjs/cloudflare"

import { getSql } from "@/lib/db"

// Vaciado del prefijo R2 de una cuenta ya borrada.
//
// El problema que resuelve está escrito en la sección 8 de la migración 0017 y
// vale repetirlo acá porque es lo que explica la forma rara de este módulo: el
// borrado de cuenta es un `delete from users` con FKs `on delete cascade`, así
// que **en el instante del DELETE no queda ninguna fila que recuerde qué hay en
// R2**. Y R2 no tiene «borrar por prefijo»: hay que listar y borrar de a 1000,
// decenas de round trips que no caben en un request.
//
// De ahí las dos piezas: una fila en `pending_media_deletions` —la tabla **sin
// FK a `users`**, lo único que sobrevive al cascade— y un job de cola que la
// consume de a tandas y se reencola con el cursor hasta que R2 confirma que el
// prefijo quedó vacío.
//
// Regla de oro del módulo: **la fila se borra solo cuando R2 confirma vacío**.
// Cualquier otra cosa —un fallo de red, un batch a medias, un Worker que muere—
// deja la fila donde está y el cron la reclama. Perder la fila es perder para
// siempre el único puntero a esos bytes; reintentar de más no cuesta nada
// porque el borrado por clave es idempotente.

// Cuántos objetos pide cada listado. Es el máximo que acepta R2 y el mismo
// número que acepta `delete` en batch, así que cada vuelta es exactamente un
// `list` y un `delete`.
export const PURGE_PAGE_SIZE = 1000

// A partir de acá el cron deja de reencolar. No borra la fila: la deja con su
// `last_error` a la vista, porque un prefijo que falló diez veces es un
// problema que hay que mirar, no uno que haya que esconder. La red de abajo es
// la lifecycle rule de 180 días del bucket, declarada en /privacy.
export const MAX_PURGE_ATTEMPTS = 10

export type PendingMediaDeletion = {
  id: string
  r2Prefix: string
  attempts: number
  lastError: string | null
}

// ---------------------------------------------------------------------------
// Lógica pura: qué borrar, cuándo terminó, cuándo rendirse
// ---------------------------------------------------------------------------

// El prefijo de un tenant. Una sola función para que el productor (el borrado de
// cuenta) y cualquier lector futuro no puedan discrepar en una barra.
export function tenantMediaPrefix(tenantId: string): string {
  return `wa/${tenantId}/`
}

export type PurgeStep = {
  // Las claves a borrar en esta vuelta.
  keys: string[]
  // Con qué cursor continuar. `null` significa «volvé a empezar del principio»,
  // no «terminaste»: quién decide eso es `done`.
  nextCursor: string | null
  // R2 confirmó el prefijo vacío.
  done: boolean
}

// Traduce un listado de R2 en la decisión de la vuelta.
//
// `done` exige **listado no truncado y cero objetos**, no «no truncado». Un
// listado no truncado con 5 objetos significa que quedan esos 5 por borrar, y
// recién el listado siguiente —el que ya no los ve— prueba que el prefijo quedó
// vacío. Esa vuelta de más es barata y es lo único que separa «creo que borré
// todo» de «R2 dice que no queda nada», que es la condición para tirar la fila.
export function planPurgeStep(listing: R2Objects): PurgeStep {
  const keys = listing.objects.map((object) => object.key)
  return {
    keys,
    // Un truncado sin cursor no debería pasar, pero si pasa se reencola desde
    // cero en vez de darlo por terminado: repetir es seguro, dar por vacío un
    // prefijo que no lo está no.
    nextCursor: listing.truncated ? (listing.cursor ?? null) : null,
    done: !listing.truncated && keys.length === 0,
  }
}

// Cuándo el cron deja de reencolar un prefijo.
export function shouldGiveUpOnPurge(attempts: number): boolean {
  return attempts >= MAX_PURGE_ATTEMPTS
}

// Las filas que el cron sí va a reencolar.
export function selectPurgesToRetry(
  rows: PendingMediaDeletion[]
): PendingMediaDeletion[] {
  return rows.filter((row) => !shouldGiveUpOnPurge(row.attempts))
}

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

export type PurgeResult = {
  deleted: number
  nextCursor: string | null
  done: boolean
}

// Una tanda: lista hasta 1000 claves bajo el prefijo, las borra y dice cómo
// seguir. El bucket entra por parámetro y no por `getCloudflareContext()` para
// que los tests puedan pasar uno falso sin runtime de Workers.
//
// Idempotente por construcción: correrla sobre un prefijo ya vacío no borra
// nada y devuelve `done: true`. Eso es lo que hace que reencolar de más —el
// modo de falla que este diseño elige tener— no tenga consecuencias.
export async function purgeMediaPrefix(input: {
  bucket: R2Bucket
  prefix: string
  cursor?: string
}): Promise<PurgeResult> {
  const listing = await input.bucket.list({
    prefix: input.prefix,
    limit: PURGE_PAGE_SIZE,
    cursor: input.cursor,
  })

  const step = planPurgeStep(listing)
  // `delete([])` sería un round trip que no borra nada.
  if (step.keys.length > 0) {
    await input.bucket.delete(step.keys)
  }

  return {
    deleted: step.keys.length,
    nextCursor: step.nextCursor,
    done: step.done,
  }
}

// ---------------------------------------------------------------------------
// Repositorio de `pending_media_deletions`
// ---------------------------------------------------------------------------

// La marca que sobrevive al cascade. `on conflict do nothing` porque el prefijo
// es único y un segundo intento de borrado de la misma cuenta —o del cron
// reclamando— no debe fallar.
export async function insertPendingMediaDeletion(
  prefix: string
): Promise<void> {
  const sql = getSql()
  await sql`
    insert into pending_media_deletions (r2_prefix)
    values (${prefix})
    on conflict (r2_prefix) do nothing
  `
}

export async function listPendingMediaDeletions(
  limit = 100
): Promise<PendingMediaDeletion[]> {
  const sql = getSql()
  const rows = await sql<
    {
      id: string
      r2_prefix: string
      attempts: number
      last_error: string | null
    }[]
  >`
    select id, r2_prefix, attempts, last_error
    from pending_media_deletions
    order by requested_at asc
    limit ${limit}
  `

  return rows.map((row) => ({
    id: row.id,
    r2Prefix: row.r2_prefix,
    attempts: row.attempts,
    lastError: row.last_error,
  }))
}

// Deja constancia de un intento fallido **sin** borrar la fila: subir `attempts`
// es lo que hace que el cron sepa cuándo rendirse, y `last_error` lo que hace
// que rendirse sea diagnosticable.
export async function recordPurgeAttempt(
  id: string,
  error: string
): Promise<void> {
  const sql = getSql()
  await sql`
    update pending_media_deletions
    set attempts = attempts + 1,
        last_error = ${error}
    where id = ${id}
  `
}

// Se llama en un solo lugar y bajo una sola condición: R2 confirmó vacío.
export async function deletePendingMediaDeletion(id: string): Promise<void> {
  const sql = getSql()
  await sql`delete from pending_media_deletions where id = ${id}`
}

async function findPendingMediaDeletionByPrefix(
  prefix: string
): Promise<PendingMediaDeletion | null> {
  const sql = getSql()
  const [row] = await sql<
    {
      id: string
      r2_prefix: string
      attempts: number
      last_error: string | null
    }[]
  >`
    select id, r2_prefix, attempts, last_error
    from pending_media_deletions
    where r2_prefix = ${prefix}
    limit 1
  `
  if (!row) return null
  return {
    id: row.id,
    r2Prefix: row.r2_prefix,
    attempts: row.attempts,
    lastError: row.last_error,
  }
}

// ---------------------------------------------------------------------------
// Productor y punto de entrada del Worker
// ---------------------------------------------------------------------------

// Lo que necesita el purgado del `env`: el bucket y la cola. Se nombra el
// subconjunto en vez de pedir `CloudflareEnv` entero para que un test pueda
// armar el doble con dos claves.
export type MediaPurgeEnv = Pick<
  CloudflareEnv,
  "WHATSAPP_MEDIA" | "WHATSAPP_JOBS"
>

// Encola el purgado. Se usa desde el borrado de cuenta **después** del DELETE y
// desde el cron; el llamador decide si un fallo acá es fatal (no lo es: la fila
// ya quedó escrita y el cron reclama).
export async function enqueueMediaPurge(input: {
  prefix: string
  cursor?: string
  queue?: Queue<WhatsappJobMessage>
}): Promise<void> {
  const queue = input.queue ?? getCloudflareContext().env.WHATSAPP_JOBS
  await queue.send({
    type: "media_purge",
    prefix: input.prefix,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  })
}

export type MediaPurgeJobResult = {
  deleted: number
  done: boolean
  // Se reencoló para seguir con el cursor siguiente.
  continued: boolean
}

// **Punto de entrada del consumidor de `whatsapp-jobs` para `media_purge`.**
// `worker.ts` (que no es de este módulo) despacha el mensaje acá; todo lo que
// sigue —listar, borrar, reencolar, tocar la fila— vive de este lado.
//
// Deja que los errores de R2 salgan como excepción después de haber anotado el
// intento: el consumidor decide si reintenta el mensaje, y la fila queda igual
// para el cron aunque la cola se rinda.
export async function handleMediaPurgeJob(input: {
  env: MediaPurgeEnv
  prefix: string
  cursor?: string
}): Promise<MediaPurgeJobResult> {
  const { prefix, cursor } = input

  // Se resuelve la fila una sola vez, antes de tocar R2, porque las dos salidas
  // la necesitan: la de error para anotar el intento y la de éxito para
  // borrarla. Que no exista no es un error: es un mensaje repetido sobre un
  // prefijo ya purgado, y la tanda de abajo es igualmente un no-op.
  const pending = await findPendingMediaDeletionByPrefix(prefix)

  let result: PurgeResult
  try {
    result = await purgeMediaPrefix({
      bucket: input.env.WHATSAPP_MEDIA,
      prefix,
      cursor,
    })
  } catch (error) {
    // Anotar el fallo es lo único que se hace acá: la fila **no** se borra y el
    // error se relanza para que el consumidor reintente el mensaje.
    if (pending) await recordPurgeAttempt(pending.id, describePurgeError(error))
    throw error
  }

  if (result.done) {
    // Único camino que borra la fila, y solo porque R2 devolvió un listado no
    // truncado y vacío.
    if (pending) await deletePendingMediaDeletion(pending.id)
    return { deleted: result.deleted, done: true, continued: false }
  }

  // Quedan objetos: se reencola la continuación en vez de seguir en el mismo
  // invocation. Un prefijo grande son decenas de round trips y el techo de CPU
  // de un mensaje de cola es real; además, cortar acá hace que un fallo pierda
  // como mucho una tanda.
  await enqueueMediaPurge({
    prefix,
    cursor: result.nextCursor ?? undefined,
    queue: input.env.WHATSAPP_JOBS,
  })

  return { deleted: result.deleted, done: false, continued: true }
}

// Red debajo de la cola, igual que `recoverWebhookJobs`: reencola los prefijos
// que quedaron con la fila puesta —porque el `send` del borrado falló, porque el
// mensaje se perdió, o porque una tanda reventó— y todavía tienen intentos.
export async function recoverPendingMediaPurges(
  env: MediaPurgeEnv
): Promise<number> {
  const pending = selectPurgesToRetry(await listPendingMediaDeletions())
  await Promise.all(
    pending.map((row) =>
      enqueueMediaPurge({ prefix: row.r2Prefix, queue: env.WHATSAPP_JOBS })
    )
  )
  return pending.length
}

function describePurgeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
