import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"
import { openWhatsappMediaStream } from "@/lib/meta/whatsapp-client"
import {
  buildMediaKey,
  isDownloadableKind,
  sanitizeFilename,
  validateMedia,
} from "@/lib/messages/media-limits"
import { log } from "@/lib/observability/logger"

// Descarga durable de un medio entrante de WhatsApp: de Meta a R2.
//
// Por qué es un job y no parte del webhook: la URL que entrega Meta dura **5
// minutos** y el media id **7 días**, pero el webhook tiene que contestar 200
// rápido o Meta lo reintenta. Así que el webhook persiste el mensaje con
// `attachment_status='pending'` y encola esto; acá se puede tardar y reintentar.
//
// R2 es la **única copia**. Lo que no se baje ahora, se pierde para siempre: a
// los 7 días el media id deja de resolver y no hay segundo intento posible.

export type MediaDownloadOutcome =
  | { ok: true; key: string; bytes: number | null }
  | { ok: false; permanent: true; reason: string }

type MediaJobRow = {
  tenant_id: string
  connected_page_id: string
  attachment_type: string | null
  attachment_status: string | null
  attachment_r2_key: string | null
  attachment_meta: Record<string, unknown> | null
  meta_page_id: string
  page_access_token_encrypted: string
}

/**
 * Baja el medio de un mensaje y lo deja en R2.
 *
 * **Idempotente**: si la fila ya tiene `attachment_r2_key`, no vuelve a bajar ni
 * a escribir. Es lo que hace que un reintento de la cola no cree dos objetos
 * —que nadie borraría, porque la fila solo recuerda una key— ni dispare dos
 * pushes.
 *
 * Los fallos se dividen en dos y no en uno: un MIME fuera de catálogo o un
 * archivo demasiado grande **no** se reintentan, porque el segundo intento va a
 * fallar igual; un error de red sí. Lo primero se marca `failed` en el acto, lo
 * segundo se lanza para que la cola reintente.
 */
export async function downloadMediaToR2(input: {
  bucket: R2Bucket
  messageId: string
  providerMediaId: string
}): Promise<MediaDownloadOutcome> {
  const sql = getSql()

  const [row] = await sql<MediaJobRow[]>`
    select m.tenant_id, m.connected_page_id, m.attachment_type,
           m.attachment_status, m.attachment_r2_key, m.attachment_meta,
           p.meta_page_id, p.page_access_token_encrypted
    from messages m
    join connected_pages p on p.id = m.connected_page_id
    where m.id = ${input.messageId}
    limit 1
  `

  if (!row) {
    // El mensaje ya no está: la cuenta se borró entre el webhook y el job. No
    // es un fallo que valga la pena reintentar.
    return { ok: false, permanent: true, reason: "message_not_found" }
  }

  if (row.attachment_r2_key) {
    return { ok: true, key: row.attachment_r2_key, bytes: null }
  }

  if (!isDownloadableKind(row.attachment_type)) {
    // Una ubicación o una reacción no tienen archivo. Si esto llega acá, el
    // parser encoló algo que no debía.
    return { ok: false, permanent: true, reason: "attachment_not_downloadable" }
  }

  const kind = row.attachment_type
  const accessToken = decryptSecret(row.page_access_token_encrypted)

  const stream = await openWhatsappMediaStream(
    accessToken,
    input.providerMediaId,
    // El `phone_number_id` es opcional y Meta lo recomienda: con él, un media id
    // de otro número responde 404 en vez de resolver. Es la comprobación de
    // propiedad del lado de Meta, y sale gratis.
    { phoneNumberId: row.meta_page_id }
  )

  const validation = validateMedia({
    kind,
    mimeType: stream.mimeType,
    sizeBytes: stream.fileSize,
  })

  if (!validation.ok) {
    await markAttachmentFailed(input.messageId, validation.reason)
    return { ok: false, permanent: true, reason: validation.reason }
  }

  if (!stream.body) {
    return { ok: false, permanent: true, reason: "empty_media_body" }
  }

  const key = buildMediaKey({
    tenantId: row.tenant_id,
    messageId: input.messageId,
  })

  const existingMeta = row.attachment_meta ?? {}
  const filename = sanitizeFilename(
    typeof existingMeta.filename === "string" ? existingMeta.filename : null
  )

  await input.bucket.put(key, stream.body, {
    httpMetadata: { contentType: stream.mimeType ?? undefined },
    // El filename va en la metadata y **nunca** en la key: es texto que eligió
    // un tercero, y dentro de un path un `../` cambia dónde termina el objeto.
    customMetadata: {
      tenantId: row.tenant_id,
      messageId: input.messageId,
      ...(filename ? { filename } : {}),
    },
  })

  const meta = JSON.stringify({
    mimeType: stream.mimeType,
    sizeBytes: stream.fileSize,
    ...(stream.sha256 ? { sha256: stream.sha256 } : {}),
    ...(filename ? { filename } : {}),
  })

  // El update lleva `attachment_r2_key is null` en el `where`: si dos entregas
  // de la cola corrieron a la vez, la segunda no pisa la key de la primera y el
  // objeto que escribió de más lo barre la lifecycle rule a los 180 días. Es la
  // misma decisión que en el resto del canal: errar hacia el objeto huérfano y
  // no hacia la fila que apunta a un lugar equivocado.
  await sql`
    update messages
    set attachment_r2_key = ${key},
        attachment_status = 'available',
        attachment_meta = coalesce(attachment_meta, '{}'::jsonb) || ${meta}::jsonb
    where id = ${input.messageId}
      and attachment_r2_key is null
  `

  return { ok: true, key, bytes: stream.fileSize }
}

/**
 * Un fallo definitivo **no borra el mensaje**: queda con
 * `attachment_status='failed'` y el webhook externo lo recibe con ese estado.
 * Perder el mensaje entero porque no se pudo bajar la foto sería peor que
 * entregarlo diciendo que la foto no está.
 */
export async function markAttachmentFailed(messageId: string, reason: string) {
  const sql = getSql()
  await sql`
    update messages
    set attachment_status = 'failed',
        attachment_meta = coalesce(attachment_meta, '{}'::jsonb)
          || ${JSON.stringify({ failureReason: reason })}::jsonb
    where id = ${messageId}
      and attachment_r2_key is null
  `

  log({
    entrypoint: "queue",
    action: "media_download",
    outcome: "failed",
    reason: "media_download_failed",
    channel: "whatsapp",
    subjectId: messageId,
  })
}
