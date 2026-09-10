import { getSql } from "@/lib/db"

// Caché de las etiquetas legibles de Inbox (migración 0014). Ninguno de los dos
// webhooks de Meta trae el dato: el de DMs manda `sender.id` a secas y el de
// comentarios manda `media.id` sin permalink ni caption. Hay que pedirlos a
// Graph, y esto es donde quedan guardados.
//
// El `synced_at` marca el **intento**, no el éxito. Sin eso, un contacto que
// Graph no resuelve —cuenta borrada, token sin permiso— se volvería a pedir en
// cada render de la pantalla.

export type ContactProfileCacheRow = {
  conversationId: string
  username: string | null
  name: string | null
  syncedAt: Date | null
}

export type MediaCacheRow = {
  connectedPageId: string
  mediaId: string
  permalink: string | null
  caption: string | null
  syncedAt: Date
}

export async function saveContactProfile(input: {
  tenantId: string
  conversationId: string
  username: string | null
  name: string | null
}) {
  const sql = getSql()
  await sql`
    update conversations
    set contact_username = ${input.username},
        contact_name = ${input.name},
        contact_synced_at = now(),
        updated_at = now()
    where id = ${input.conversationId}
      and tenant_id = ${input.tenantId}
  `
}

export async function listCachedMedia(input: {
  connectedPageId: string
  mediaIds: string[]
}) {
  if (input.mediaIds.length === 0) return []

  const sql = getSql()
  const rows = await sql<
    {
      connected_page_id: string
      media_id: string
      permalink: string | null
      caption: string | null
      synced_at: Date
    }[]
  >`
    select connected_page_id, media_id, permalink, caption, synced_at
    from instagram_media
    where connected_page_id = ${input.connectedPageId}
      and media_id = any(${input.mediaIds})
  `

  return rows.map((row) => ({
    connectedPageId: row.connected_page_id,
    mediaId: row.media_id,
    permalink: row.permalink,
    caption: row.caption,
    syncedAt: row.synced_at,
  }))
}

export async function saveMedia(input: {
  connectedPageId: string
  mediaId: string
  permalink: string | null
  caption: string | null
  mediaProductType: string | null
}) {
  const sql = getSql()
  // `do update` y no `do nothing`: la segunda pasada por una publicación que la
  // primera vez no resolvió tiene que poder completarla.
  await sql`
    insert into instagram_media (
      connected_page_id, media_id, permalink, caption, media_product_type
    )
    values (
      ${input.connectedPageId}, ${input.mediaId}, ${input.permalink},
      ${input.caption}, ${input.mediaProductType}
    )
    on conflict (connected_page_id, media_id)
    do update set
      permalink = excluded.permalink,
      caption = excluded.caption,
      media_product_type = excluded.media_product_type,
      synced_at = now()
  `
}
