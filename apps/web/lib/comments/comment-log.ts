import { getSql } from "@/lib/db"

// Persistencia de `instagram_comments`. Es el gemelo de `messages/message-log.ts`
// para el otro sujeto: un comentario cuelga de una publicación, se anida y su
// respuesta pública no tiene ventana de 24 horas, así que vive en su propia
// tabla en vez de en `messages` con media docena de columnas nullable
// (migración 0013).

export type CommentDirection = "inbound" | "outbound"
export type CommentStatus = "received" | "sent" | "failed"

export type InstagramCommentRecord = {
  id: string
  tenantId: string
  connectedPageId: string
  igCommentId: string | null
  parentIgCommentId: string | null
  mediaId: string
  mediaProductType: string | null
  fromIgId: string
  fromUsername: string | null
  direction: CommentDirection
  status: CommentStatus
  text: string
  error: string | null
  providerResponse: unknown | null
  createdAt: Date
}

type InstagramCommentRow = {
  id: string
  tenant_id: string
  connected_page_id: string
  ig_comment_id: string | null
  parent_ig_comment_id: string | null
  media_id: string
  media_product_type: string | null
  from_ig_id: string
  from_username: string | null
  direction: CommentDirection
  status: CommentStatus
  text: string
  error: string | null
  provider_response: unknown | null
  created_at: Date
}

// Inserta el comentario entrante y devuelve si fue nuevo, con la **misma forma
// que `insertInboundMessage`**: `{ comment, inserted }`. Ese booleano es la
// señal de dedupe que la ingesta usa para no reenviar dos veces lo mismo.
//
// El dedupe vive en el índice único parcial `(connected_page_id, ig_comment_id)`
// y no en la aplicación, igual que en `messages`: Meta reintenta el mismo
// webhook y dos requests concurrentes no se ven entre sí.
export async function insertInboundComment(input: {
  tenantId: string
  connectedPageId: string
  igCommentId: string
  parentIgCommentId: string | null
  mediaId: string
  mediaProductType: string | null
  fromIgId: string
  fromUsername: string | null
  text: string
  createdAt: Date
}) {
  const sql = getSql()

  const [row] = await sql<InstagramCommentRow[]>`
    insert into instagram_comments (
      tenant_id,
      connected_page_id,
      ig_comment_id,
      parent_ig_comment_id,
      media_id,
      media_product_type,
      from_ig_id,
      from_username,
      direction,
      status,
      text,
      created_at
    )
    values (
      ${input.tenantId},
      ${input.connectedPageId},
      ${input.igCommentId},
      ${input.parentIgCommentId},
      ${input.mediaId},
      ${input.mediaProductType},
      ${input.fromIgId},
      ${input.fromUsername},
      'inbound',
      'received',
      ${input.text},
      ${input.createdAt}
    )
    on conflict (connected_page_id, ig_comment_id)
      where ig_comment_id is not null and direction = 'inbound'
    do nothing
    returning id, tenant_id, connected_page_id, ig_comment_id,
      parent_ig_comment_id, media_id, media_product_type, from_ig_id,
      from_username, direction, status, text, error, provider_response,
      created_at
  `

  if (row) return { comment: mapComment(row), inserted: true }

  // El `do nothing` no devuelve fila: el comentario ya estaba. Se relee para
  // que el llamador tenga el registro igual, aunque no lo vaya a reenviar.
  const [existing] = await sql<InstagramCommentRow[]>`
    select id, tenant_id, connected_page_id, ig_comment_id,
      parent_ig_comment_id, media_id, media_product_type, from_ig_id,
      from_username, direction, status, text, error, provider_response,
      created_at
    from instagram_comments
    where connected_page_id = ${input.connectedPageId}
      and ig_comment_id = ${input.igCommentId}
      and direction = 'inbound'
    limit 1
  `

  if (existing) return { comment: mapComment(existing), inserted: false }

  throw new Error("comment insert failed")
}

// Resuelve el comentario entrante que se quiere contestar. La ruta de respuesta
// recibe el id de Meta —que es lo que el tenant tiene, porque es el que le llegó
// en el push— y necesita de acá tres cosas que Meta no le va a dar de vuelta: a
// qué publicación pertenece (`media_id` es `not null` en la fila saliente), el
// IGSID de quien comentó (para la respuesta privada) y la confirmación de que
// el comentario es de este tenant.
//
// Se filtra por `connected_page_id` y no solo por tenant: el mismo tenant puede
// tener dos cuentas conectadas, y contestar con el token de una un comentario de
// la otra es un 100 de Meta que no dice cuál fue el problema.
export async function getInboundCommentByIgCommentId(input: {
  tenantId: string
  connectedPageId: string
  igCommentId: string
}) {
  const sql = getSql()
  const [row] = await sql<InstagramCommentRow[]>`
    select id, tenant_id, connected_page_id, ig_comment_id,
      parent_ig_comment_id, media_id, media_product_type, from_ig_id,
      from_username, direction, status, text, error, provider_response,
      created_at
    from instagram_comments
    where tenant_id = ${input.tenantId}
      and connected_page_id = ${input.connectedPageId}
      and ig_comment_id = ${input.igCommentId}
      and direction = 'inbound'
    limit 1
  `

  return row ? mapComment(row) : null
}

// Persiste la respuesta pública, la haya aceptado Meta o no. Es el gemelo de
// `insertOutboundMessage` y guarda lo mismo por la misma razón: el rechazo es
// justamente lo que el usuario necesita poder ver en el log.
//
// `parent_ig_comment_id` es el comentario que se contestó. Notar que Instagram
// solo anida un nivel: al responder una respuesta, el comentario queda colgado
// del comentario raíz igual, pero acá se guarda a cuál se apuntó, que es lo que
// hace falta para reconstruir la intención.
export async function insertOutboundComment(input: {
  tenantId: string
  connectedPageId: string
  igCommentId: string | null
  parentIgCommentId: string
  mediaId: string
  mediaProductType: string | null
  fromIgId: string
  fromUsername: string | null
  status: "sent" | "failed"
  text: string
  idempotencyKey: string | null
  error: string | null
  providerResponse: unknown
  createdAt: Date
}) {
  const sql = getSql()
  const providerResponse =
    input.providerResponse == null
      ? null
      : JSON.stringify(input.providerResponse)

  const [row] = await sql<InstagramCommentRow[]>`
    insert into instagram_comments (
      tenant_id,
      connected_page_id,
      ig_comment_id,
      parent_ig_comment_id,
      media_id,
      media_product_type,
      from_ig_id,
      from_username,
      direction,
      status,
      text,
      idempotency_key,
      error,
      provider_response,
      created_at
    )
    values (
      ${input.tenantId},
      ${input.connectedPageId},
      ${input.igCommentId},
      ${input.parentIgCommentId},
      ${input.mediaId},
      ${input.mediaProductType},
      ${input.fromIgId},
      ${input.fromUsername},
      'outbound',
      ${input.status},
      ${input.text},
      ${input.idempotencyKey},
      ${input.error},
      ${providerResponse}::jsonb,
      ${input.createdAt}
    )
    returning id, tenant_id, connected_page_id, ig_comment_id,
      parent_ig_comment_id, media_id, media_product_type, from_ig_id,
      from_username, direction, status, text, error, provider_response,
      created_at
  `

  if (!row) throw new Error("outbound comment insert failed")
  return mapComment(row)
}

export async function getOutboundCommentByIdempotencyKey(
  tenantId: string,
  idempotencyKey: string
) {
  const sql = getSql()
  const [row] = await sql<InstagramCommentRow[]>`
    select id, tenant_id, connected_page_id, ig_comment_id,
      parent_ig_comment_id, media_id, media_product_type, from_ig_id,
      from_username, direction, status, text, error, provider_response,
      created_at
    from instagram_comments
    where tenant_id = ${tenantId}
      and idempotency_key = ${idempotencyKey}
      and direction = 'outbound'
    limit 1
  `

  return row ? mapComment(row) : null
}

// **Tercera señal anti-bucle**, y la única que no depende de que Meta mande
// bien el `from`. Desde la etapa 6 Resender publica comentarios, así que ahora
// existe la fila que dice "este ig_comment_id lo escribimos nosotros" y la
// ingesta puede preguntarla.
//
// Las otras dos señales —`from.id === entry.id` en el parser y el @handle en la
// ingesta— siguen estando y siguen cortando antes; esta es la que queda si Meta
// alguna vez manda el `from` de una respuesta propia con otra forma.
export async function isOwnPublishedComment(input: {
  connectedPageId: string
  igCommentId: string
}) {
  const sql = getSql()
  const [row] = await sql<{ id: string }[]>`
    select id
    from instagram_comments
    where connected_page_id = ${input.connectedPageId}
      and ig_comment_id = ${input.igCommentId}
      and direction = 'outbound'
    limit 1
  `

  return row !== undefined
}

// La lectura del hilo de una publicación vive en `lib/comments/read-model.ts`,
// no acá: `listCommentsForMedia` devolvía el registro entero —`provider_response`
// incluido, que puede ser un cuerpo de error de Graph completo— para una
// pantalla que solo pinta ocho campos, y nunca llegó a tener un call site.

function mapComment(row: InstagramCommentRow): InstagramCommentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    connectedPageId: row.connected_page_id,
    igCommentId: row.ig_comment_id,
    parentIgCommentId: row.parent_ig_comment_id,
    mediaId: row.media_id,
    mediaProductType: row.media_product_type,
    fromIgId: row.from_ig_id,
    fromUsername: row.from_username,
    direction: row.direction,
    status: row.status,
    text: row.text,
    error: row.error,
    providerResponse: row.provider_response,
    createdAt: row.created_at,
  }
}
