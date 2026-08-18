import { getSql } from "@/lib/db"

export type ConversationRecord = {
  id: string
  tenantId: string
  connectedPageId: string
  contactId: string
  contactName: string | null
  lastMessageAt: Date
}

export type MessageDirection = "inbound" | "outbound"
export type MessageStatus = "received" | "sent" | "failed"

export type MessageRecord = {
  id: string
  tenantId: string
  conversationId: string
  connectedPageId: string
  contactId: string
  direction: MessageDirection
  status: MessageStatus
  text: string
  metaMessageId: string | null
  idempotencyKey: string | null
  // Informado solo en una **respuesta privada a un comentario** de Instagram:
  // guarda el comentario que la originó. Es lo único que distingue ese DM de
  // uno normal, y lo que permite auditar el límite de una sola respuesta
  // privada por comentario (migración 0013).
  instagramSourceCommentId: string | null
  // Adjunto del mensaje (migración 0016). Las tres van juntas o el tipo va
  // solo: la URL es efímera (la firma el CDN de Meta) y puede faltar en tipos
  // sin payload descargable (`appointment_booking`, `template`), y el meta
  // guarda los detalles que varían por tipo más el `title` cuando lo hubo.
  attachmentType: string | null
  attachmentUrl: string | null
  attachmentMeta: Record<string, unknown> | null
  error: string | null
  providerResponse: unknown | null
  createdAt: Date
}

type ConversationRow = {
  id: string
  tenant_id: string
  connected_page_id: string
  contact_id: string
  contact_name: string | null
  last_message_at: Date
}

type MessageRow = {
  id: string
  tenant_id: string
  conversation_id: string
  connected_page_id: string
  contact_id: string
  direction: MessageDirection
  status: MessageStatus
  text: string
  meta_message_id: string | null
  idempotency_key: string | null
  instagram_source_comment_id: string | null
  attachment_type: string | null
  attachment_url: string | null
  attachment_meta: unknown | null
  error: string | null
  provider_response: unknown | null
  created_at: Date
}

export async function upsertConversation(input: {
  tenantId: string
  connectedPageId: string
  contactId: string
  lastMessageAt: Date
}) {
  const sql = getSql()
  const [row] = await sql<ConversationRow[]>`
    insert into conversations (
      tenant_id,
      connected_page_id,
      contact_id,
      last_message_at
    )
    values (
      ${input.tenantId},
      ${input.connectedPageId},
      ${input.contactId},
      ${input.lastMessageAt}
    )
    on conflict (connected_page_id, contact_id)
    do update set
      last_message_at = greatest(conversations.last_message_at, excluded.last_message_at),
      updated_at = now()
    returning id, tenant_id, connected_page_id, contact_id, contact_name, last_message_at
  `

  if (!row) throw new Error("conversation upsert failed")
  return mapConversation(row)
}

export async function insertInboundMessage(input: {
  tenantId: string
  conversationId: string
  connectedPageId: string
  contactId: string
  text: string
  metaMessageId: string | null
  // Adjunto ya normalizado por el parser. `details` puede ser `{}` y se guarda
  // como `{}` —no como null—: que el jsonb exista dice "hubo adjunto y no tenía
  // detalles", que no es lo mismo que "no hubo adjunto".
  attachment?: {
    type: string
    url: string | null
    title: string | null
    details: Record<string, unknown>
  } | null
  createdAt: Date
}) {
  const sql = getSql()

  const attachment = input.attachment ?? null
  // El `title` viaja adentro del jsonb y no en columna propia: solo lo traen
  // unos pocos tipos (reel, post, fallback) y `buildInboundPushPayload` hace el
  // split inverso exacto al armar el payload, así que lo guardado y lo pusheado
  // son el mismo objeto. Solo se agrega la clave cuando hubo título.
  const attachmentMeta = attachment
    ? JSON.stringify(
        attachment.title
          ? { ...attachment.details, title: attachment.title }
          : attachment.details
      )
    : null

  const [row] = await sql<MessageRow[]>`
    insert into messages (
      tenant_id,
      conversation_id,
      connected_page_id,
      contact_id,
      direction,
      status,
      text,
      meta_message_id,
      attachment_type,
      attachment_url,
      attachment_meta,
      created_at
    )
    values (
      ${input.tenantId},
      ${input.conversationId},
      ${input.connectedPageId},
      ${input.contactId},
      'inbound',
      'received',
      ${input.text},
      ${input.metaMessageId},
      ${attachment ? attachment.type : null},
      ${attachment ? attachment.url : null},
      ${attachmentMeta}::jsonb,
      ${input.createdAt}
    )
    on conflict (connected_page_id, meta_message_id)
      where meta_message_id is not null and direction = 'inbound'
    do nothing
    returning id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, error, provider_response, created_at
  `

  if (row) return { message: mapMessage(row), inserted: true }

  if (input.metaMessageId) {
    const [existing] = await sql<MessageRow[]>`
      select id, tenant_id, conversation_id, connected_page_id, contact_id,
        direction, status, text, meta_message_id, idempotency_key,
        instagram_source_comment_id, attachment_type, attachment_url,
        attachment_meta, error, provider_response, created_at
      from messages
      where connected_page_id = ${input.connectedPageId}
        and meta_message_id = ${input.metaMessageId}
        and direction = 'inbound'
      limit 1
    `

    if (existing) return { message: mapMessage(existing), inserted: false }
  }

  throw new Error("message insert failed")
}

export async function getConversationById(
  tenantId: string,
  conversationId: string
) {
  const sql = getSql()
  const [row] = await sql<ConversationRow[]>`
    select id, tenant_id, connected_page_id, contact_id, contact_name, last_message_at
    from conversations
    where id = ${conversationId} and tenant_id = ${tenantId}
    limit 1
  `

  return row ? mapConversation(row) : null
}

export async function insertOutboundMessage(input: {
  tenantId: string
  conversationId: string
  connectedPageId: string
  contactId: string
  text: string
  status: "sent" | "failed"
  metaMessageId: string | null
  idempotencyKey: string | null
  // Solo lo informa la ruta de respuesta privada a un comentario; en un DM
  // normal va null y la columna queda vacía, que es lo que la distingue.
  instagramSourceCommentId?: string | null
  // Adjunto saliente: solo tipo y URL, porque el que envía siempre tiene URL
  // (es lo que manda a Meta) y no hay `details` que guardar — `attachment_meta`
  // queda null a propósito.
  attachment?: { type: string; url: string } | null
  error: string | null
  providerResponse: unknown
  createdAt: Date
}) {
  const sql = getSql()
  const providerResponse =
    input.providerResponse == null
      ? null
      : JSON.stringify(input.providerResponse)

  // Batch atómico (driver HTTP de Neon): las queries se crean sin await y se
  // ejecutan juntas en una transacción no interactiva.
  const insertMessage = sql<MessageRow[]>`
    insert into messages (
      tenant_id,
      conversation_id,
      connected_page_id,
      contact_id,
      direction,
      status,
      text,
      meta_message_id,
      idempotency_key,
      instagram_source_comment_id,
      attachment_type,
      attachment_url,
      error,
      provider_response,
      created_at
    )
    values (
      ${input.tenantId},
      ${input.conversationId},
      ${input.connectedPageId},
      ${input.contactId},
      'outbound',
      ${input.status},
      ${input.text},
      ${input.metaMessageId},
      ${input.idempotencyKey},
      ${input.instagramSourceCommentId ?? null},
      ${input.attachment?.type ?? null},
      ${input.attachment?.url ?? null},
      ${input.error},
      ${providerResponse}::jsonb,
      ${input.createdAt}
    )
    returning id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, error, provider_response, created_at
  `

  const touchConversation = sql`
    update conversations
    set last_message_at = greatest(last_message_at, ${input.createdAt}),
      updated_at = now()
    where id = ${input.conversationId} and tenant_id = ${input.tenantId}
  `

  const [insertedRows] = await sql.transaction([
    insertMessage,
    touchConversation,
  ])
  const row = (insertedRows as MessageRow[])[0]
  if (!row) throw new Error("outbound message insert failed")

  return mapMessage(row)
}

export async function getOutboundMessageByIdempotencyKey(
  tenantId: string,
  idempotencyKey: string
) {
  const sql = getSql()
  const [row] = await sql<MessageRow[]>`
    select id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, error, provider_response, created_at
    from messages
    where tenant_id = ${tenantId}
      and idempotency_key = ${idempotencyKey}
      and direction = 'outbound'
    limit 1
  `

  return row ? mapMessage(row) : null
}

// Instagram permite **una sola** respuesta privada por comentario y la rechaza
// con un 100/2534025 que junta cuatro causas distintas, así que si dejáramos
// que Meta sea el que avise, el usuario recibiría un error ambiguo por algo que
// nosotros sabemos con certeza. Esta lectura es la que convierte ese caso en un
// 409 que dice exactamente qué pasó.
//
// Solo cuenta el envío que Meta aceptó: un intento fallido no consumió la única
// respuesta disponible y tiene que poder reintentarse.
export async function getPrivateReplyForComment(input: {
  tenantId: string
  igCommentId: string
}) {
  const sql = getSql()
  const [row] = await sql<MessageRow[]>`
    select id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, error, provider_response, created_at
    from messages
    where tenant_id = ${input.tenantId}
      and instagram_source_comment_id = ${input.igCommentId}
      and direction = 'outbound'
      and status = 'sent'
    limit 1
  `

  return row ? mapMessage(row) : null
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    connectedPageId: row.connected_page_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    lastMessageAt: row.last_message_at,
  }
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    connectedPageId: row.connected_page_id,
    contactId: row.contact_id,
    direction: row.direction,
    status: row.status,
    text: row.text ?? "",
    metaMessageId: row.meta_message_id,
    idempotencyKey: row.idempotency_key,
    instagramSourceCommentId: row.instagram_source_comment_id,
    attachmentType: row.attachment_type,
    attachmentUrl: row.attachment_url,
    // El driver ya deserializa el jsonb; el cast solo fija la forma que el
    // resto del código espera (claves string, valores desconocidos).
    attachmentMeta: (row.attachment_meta ?? null) as Record<
      string,
      unknown
    > | null,
    error: row.error,
    providerResponse: row.provider_response,
    createdAt: row.created_at,
  }
}
