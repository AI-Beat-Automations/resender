import { getCloudflareContext } from "@opennextjs/cloudflare"

import { getSql } from "@/lib/db"

import { effectiveStatus, type AttachmentStatus } from "./media-retention"

// Autorización y lectura de un medio entrante de WhatsApp.
//
// La regla de oro de este módulo: **R2 guarda bytes, Postgres decide quién los
// puede pedir**. La key es no adivinable y lleva el tenant adelante
// (`wa/{tenantId}/{messageId}/{random}`), pero eso es defensa en profundidad, no
// autorización: lo que autoriza es la fila de `messages`, que es la única que
// sabe de quién es el mensaje.

export type MediaRow = {
  attachment_r2_key: string | null
  attachment_status: AttachmentStatus | null
  attachment_meta: Record<string, unknown> | null
  created_at: Date
}

export type MediaLookup =
  | { ok: true; key: string; mimeType: string; sizeBytes: number | null }
  // `not_found` cubre dos casos a propósito —no existe, o existe y es de otro
  // tenant— porque la ruta contesta 404 en los dos. Un 403 sobre un id ajeno
  // confirmaría que ese id existe, que es justo lo que no hay que decirle a
  // quien está probando ids.
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_available"; status: AttachmentStatus }

/**
 * Busca el medio de un mensaje **dentro del tenant**, y decide si se puede
 * servir. El `tenant_id` va en el `where` y no en un `if` posterior: así no hay
 * forma de olvidarse de comprobarlo.
 */
export async function lookupMediaForTenant(input: {
  tenantId: string
  messageId: string
  now?: Date
}): Promise<MediaLookup> {
  const sql = getSql()
  const [row] = await sql<MediaRow[]>`
    select attachment_r2_key, attachment_status, attachment_meta, created_at
    from messages
    where id = ${input.messageId}
      and tenant_id = ${input.tenantId}
    limit 1
  `

  if (!row) return { ok: false, reason: "not_found" }

  // Un mensaje sin `attachment_status` no es un medio que no se pueda servir:
  // es un mensaje sin adjunto. Se contesta 404 y no 409 porque no hay ningún
  // estado que reportarle al cliente.
  if (!row.attachment_status) return { ok: false, reason: "not_found" }

  // El estado se **deriva** de la edad en vez de leerse tal cual: la retención
  // de 180 días la aplica una lifecycle rule de R2, sin código que marque las
  // filas, así que una fila puede decir `available` sobre un objeto que el
  // bucket ya borró. Derivarlo es lo que impide que los dos se separen.
  const status = effectiveStatus(
    { attachment_status: row.attachment_status, created_at: row.created_at },
    input.now ?? new Date()
  )

  if (status !== "available" || !row.attachment_r2_key) {
    return { ok: false, reason: "not_available", status }
  }

  const meta = row.attachment_meta ?? {}
  const mimeType =
    typeof meta.mimeType === "string"
      ? meta.mimeType
      : "application/octet-stream"
  const sizeBytes = typeof meta.sizeBytes === "number" ? meta.sizeBytes : null

  return { ok: true, key: row.attachment_r2_key, mimeType, sizeBytes }
}

export function getMediaBucket() {
  return getCloudflareContext().env.WHATSAPP_MEDIA
}
