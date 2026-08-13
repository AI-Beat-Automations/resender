import { getSql } from "@/lib/db"
import type { PageChannel } from "@/lib/pages/page-registry"

import type { CommentDirection, CommentStatus } from "./comment-log"

// Lectura de comentarios para la pantalla. Gemelo de `lib/messages/read-model.ts`
// para el otro sujeto de Inbox, y separado de `comment-log.ts` por el mismo
// motivo: el log escribe y devuelve el registro entero —`provider_response`
// incluido, que puede ser un cuerpo de error de Graph completo—, y esto lee lo
// que la pantalla pinta y nada más.
//
// La unidad de la lista es la PUBLICACIÓN, no el comentario suelto ni el
// contacto: un comentario cuelga de un post y fuera de ese hilo no significa
// nada. La clave es el par `(connected_page_id, media_id)`, porque `media_id`
// es un id de Meta y solo es único dentro de la cuenta que lo publicó.

export type PublicationListItem = {
  connectedPageId: string
  mediaId: string
  mediaProductType: string | null
  commentCount: number
  lastCommentAt: Date
  account: {
    channel: PageChannel
    metaPageId: string
    name: string
    username: string | null
  }
  // No es nullable, a diferencia de `latestMessage`: una publicación aparece en
  // esta lista solo porque tiene al menos un comentario.
  latestComment: {
    text: string
    direction: CommentDirection
    status: CommentStatus
    fromIgId: string
    fromUsername: string | null
    createdAt: Date
  }
}

export type PublicationComment = {
  id: string
  igCommentId: string | null
  parentIgCommentId: string | null
  direction: CommentDirection
  status: CommentStatus
  text: string
  error: string | null
  fromIgId: string
  fromUsername: string | null
  createdAt: Date
}

type PublicationListRow = {
  connected_page_id: string
  media_id: string
  comment_count: number
  last_comment_at: Date
  media_product_type: string | null
  page_channel: PageChannel
  meta_page_id: string
  account_name: string
  account_username: string | null
  latest_text: string
  latest_direction: CommentDirection
  latest_status: CommentStatus
  latest_from_ig_id: string
  latest_from_username: string | null
  latest_created_at: Date
}

type PublicationCommentRow = {
  id: string
  ig_comment_id: string | null
  parent_ig_comment_id: string | null
  direction: CommentDirection
  status: CommentStatus
  text: string
  error: string | null
  from_ig_id: string
  from_username: string | null
  created_at: Date
}

export async function listPublicationReadModel(input: {
  tenantId: string
  connectedPageId?: string
}) {
  const sql = getSql()
  // `count(*)::int` con el cast puesto: el driver HTTP de Neon entrega `bigint`
  // como string. Es el mismo cast que `countActiveAccounts`.
  //
  // El lateral repite `tenant_id` a propósito, aunque la agregación ya lo
  // filtró: sin RLS, un scan correlacionado que no lo lleve podría salirse del
  // slice del tenant si alguien reordena el join. Es `join` y no `left join`
  // porque una publicación agrupada siempre tiene último comentario.
  const rows = await sql<PublicationListRow[]>`
    select
      agg.connected_page_id,
      agg.media_id,
      agg.comment_count,
      agg.last_comment_at,
      agg.media_product_type,
      p.channel as page_channel,
      p.meta_page_id,
      p.name as account_name,
      p.username as account_username,
      latest.text as latest_text,
      latest.direction as latest_direction,
      latest.status as latest_status,
      latest.from_ig_id as latest_from_ig_id,
      latest.from_username as latest_from_username,
      latest.created_at as latest_created_at
    from (
      select
        connected_page_id,
        media_id,
        count(*)::int as comment_count,
        max(created_at) as last_comment_at,
        -- media_product_type es del post, no del comentario, pero es nullable
        -- en las dos direcciones: Meta no siempre lo manda. max() ignora
        -- nulls, así que alcanza con que una sola fila del grupo lo traiga.
        max(media_product_type) as media_product_type
      from instagram_comments
      where tenant_id = ${input.tenantId}
        and (${input.connectedPageId ?? null}::uuid is null or connected_page_id = ${input.connectedPageId ?? null}::uuid)
      group by connected_page_id, media_id
    ) agg
    join connected_pages p on p.id = agg.connected_page_id
    join lateral (
      select text, direction, status, from_ig_id, from_username, created_at
      from instagram_comments c
      where c.tenant_id = ${input.tenantId}
        and c.connected_page_id = agg.connected_page_id
        and c.media_id = agg.media_id
      order by c.created_at desc
      limit 1
    ) latest on true
    order by agg.last_comment_at desc
  `

  return rows.map(mapPublicationListItem)
}

export async function listPublicationComments(input: {
  tenantId: string
  connectedPageId: string
  mediaId: string
}) {
  const sql = getSql()
  // Orden cronológico ascendente, no inverso: un hilo se entiende de arriba
  // hacia abajo. Es el orden del índice `instagram_comments_media_idx`, que
  // calza exacto con este `where`.
  //
  // Trae los dos ids de Meta porque el display resuelve en memoria a qué
  // comentario contesta cada saliente; sin ellos haría falta otra consulta.
  const rows = await sql<PublicationCommentRow[]>`
    select id, ig_comment_id, parent_ig_comment_id, direction, status, text,
      error, from_ig_id, from_username, created_at
    from instagram_comments
    where tenant_id = ${input.tenantId}
      and connected_page_id = ${input.connectedPageId}
      and media_id = ${input.mediaId}
    order by created_at asc
  `

  return rows.map((row) => ({
    id: row.id,
    igCommentId: row.ig_comment_id,
    parentIgCommentId: row.parent_ig_comment_id,
    direction: row.direction,
    status: row.status,
    text: row.text,
    error: row.error,
    fromIgId: row.from_ig_id,
    fromUsername: row.from_username,
    createdAt: row.created_at,
  }))
}

function mapPublicationListItem(row: PublicationListRow): PublicationListItem {
  return {
    connectedPageId: row.connected_page_id,
    mediaId: row.media_id,
    mediaProductType: row.media_product_type,
    commentCount: row.comment_count,
    lastCommentAt: row.last_comment_at,
    account: {
      channel: row.page_channel,
      metaPageId: row.meta_page_id,
      name: row.account_name,
      username: row.account_username,
    },
    latestComment: {
      text: row.latest_text,
      direction: row.latest_direction,
      status: row.latest_status,
      fromIgId: row.latest_from_ig_id,
      fromUsername: row.latest_from_username,
      createdAt: row.latest_created_at,
    },
  }
}
