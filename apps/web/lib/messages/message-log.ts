import { getSql } from "@/lib/db"

import { overwritableBy } from "./delivery-status"

import type {
  AttachmentStatus,
  DeliveryStatus,
  MessageOrigin,
} from "./message-enums"

export type ConversationRecord = {
  id: string
  tenantId: string
  connectedPageId: string
  contactId: string
  contactName: string | null
  lastMessageAt: Date
  // Último entrante **real del cliente**: la fuente de la ventana de 24 h.
  // Distinta de `lastMessageAt`, que lo bumpean las dos direcciones. Ver
  // `opensCustomerServiceWindow`.
  lastInboundAt: Date | null
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
  // Columnas de la 0017. Nacen con WhatsApp pero la fila es una sola, así que
  // Messenger e Instagram también las tienen: `origin` backfilleado por la
  // migración, `historical` en false y las tres de media en null. Van en el
  // tipo y no en un `WhatsappMessageRecord` aparte porque el sobre que sale al
  // tenant se arma desde `MessageRecord` para los tres canales.
  //
  // **Opcionales en el tipo, siempre informadas por `mapMessage`.** Lo que sale
  // de la base las trae todas; opcionales son para que un registro armado a
  // mano —fixtures y llamadores escritos antes de la 0017— no tenga que
  // enumerar seis columnas que no le dicen nada. Quien lee una fila real puede
  // asumirlas presentes.
  origin?: MessageOrigin | null
  historical?: boolean
  // Lo que reporta Meta, separado del `status` interno. Lo mueven los
  // callbacks de `statuses[]` con la monotonía de `delivery-status.ts`.
  deliveryStatus?: DeliveryStatus | null
  // Ciclo de vida del binario. Null cuando no hay binario que bajar
  // (ubicación, reacción, respuesta interactiva) o cuando el canal no baja
  // nada, que es el caso de Messenger e Instagram.
  attachmentStatus?: AttachmentStatus | null
  // La clave del objeto en R2, que solo escribe el job de descarga.
  attachmentR2Key?: string | null
  // El wamid al que este mensaje responde. Se guarda como lo manda Meta y no
  // como uuid nuestro: el mensaje citado puede ser anterior a la conexión.
  replyToMetaMessageId?: string | null
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
  last_inbound_at: Date | null
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
  origin: MessageOrigin | null
  historical: boolean
  delivery_status: DeliveryStatus | null
  attachment_status: AttachmentStatus | null
  attachment_r2_key: string | null
  reply_to_meta_message_id: string | null
  error: string | null
  provider_response: unknown | null
  created_at: Date
}

/**
 * Si este mensaje abre (o reabre) la ventana de atención de 24 horas.
 *
 * Son tres condiciones y las tres importan, porque cada una tapa una forma
 * distinta de abrir la ventana sin que nadie nos haya escrito:
 *
 * - `direction === "inbound"` — un saliente nuestro no la abre. Por eso
 *   `conversations.last_message_at` no sirve de fuente: lo bumpean las dos
 *   direcciones, así que una conversación donde solo hablamos nosotros
 *   parecería abierta para siempre.
 * - `!historical` — el historial que importa Coexistence son conversaciones que
 *   ocurrieron fuera de Resender, algunas de hace 180 días. Sin este filtro,
 *   conectar un número abriría de golpe la ventana de cada contacto que alguna
 *   vez escribió.
 * - `origin === "customer"` — el eco de lo que el negocio tecleó en la
 *   WhatsApp Business App llega como mensaje pero lo escribió el negocio, no el
 *   cliente. Meta no reabre la ventana por eso y nosotros tampoco.
 *
 * Es una función exportada y no un `if` adentro del SQL para que los tests
 * puedan recorrer los cuatro casos sin base de datos.
 */
export function opensCustomerServiceWindow(message: {
  direction: "inbound" | "outbound"
  historical?: boolean
  origin?: MessageOrigin | null
}): boolean {
  if (message.direction !== "inbound") return false
  if (message.historical) return false
  // Messenger e Instagram no escriben `origin` en el insert y su entrante
  // siempre es del cliente: la 0017 los backfilleó a 'customer' justamente para
  // que este filtro no los dejara mudos. `null` acá es "canal sin origen", no
  // "origen desconocido".
  return message.origin == null || message.origin === "customer"
}

export async function upsertConversation(input: {
  tenantId: string
  connectedPageId: string
  contactId: string
  lastMessageAt: Date
  /**
   * De qué mensaje viene este upsert. Solo se usa para decidir si mover
   * `last_inbound_at`, y va como objeto —en vez de un `lastInboundAt: Date`
   * ya calculado por el llamador— porque la regla tiene que vivir en **un solo
   * lugar**: `last_inbound_at` es estado derivado, y un parser nuevo que se
   * olvide de aplicarla deja la conversación muda sin que nada falle.
   *
   * Opcional para no tocar a los llamadores que no traen un mensaje entrante.
   */
  message?: {
    direction: "inbound" | "outbound"
    historical?: boolean
    origin?: MessageOrigin | null
  }
}) {
  const sql = getSql()

  // `greatest` ignora los NULL, así que pasar null cuando el mensaje no abre
  // ventana no pisa lo que ya había: el upsert queda con una sola forma en vez
  // de dos ramas de SQL condicional, que el driver HTTP de Neon no arma bien.
  const lastInboundAt =
    input.message && opensCustomerServiceWindow(input.message)
      ? input.lastMessageAt
      : null

  const [row] = await sql<ConversationRow[]>`
    insert into conversations (
      tenant_id,
      connected_page_id,
      contact_id,
      last_message_at,
      last_inbound_at
    )
    values (
      ${input.tenantId},
      ${input.connectedPageId},
      ${input.contactId},
      ${input.lastMessageAt},
      ${lastInboundAt}
    )
    on conflict (connected_page_id, contact_id)
    do update set
      last_message_at = greatest(conversations.last_message_at, excluded.last_message_at),
      last_inbound_at = greatest(conversations.last_inbound_at, excluded.last_inbound_at),
      updated_at = now()
    returning id, tenant_id, connected_page_id, contact_id, contact_name, last_message_at, last_inbound_at
  `

  if (!row) throw new Error("conversation upsert failed")
  return mapConversation(row)
}

// Lo que necesita cualquier fila de mensaje que venga de un webhook de Meta,
// sea entrante viva, eco de la Business App o importada del historial. Los tres
// escriben las mismas columnas; lo que cambia es la dirección, el índice único
// contra el que deduplican y quién las reenvía.
type ProviderMessageInput = {
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
  // Columnas de la 0017, todas opcionales: Messenger e Instagram no las mandan
  // y la fila queda como quedaba antes de que WhatsApp existiera.
  origin?: MessageOrigin | null
  historical?: boolean
  deliveryStatus?: DeliveryStatus | null
  attachmentStatus?: AttachmentStatus | null
  // Lo escribe el job de descarga, no la ingesta; va en el tipo para que el
  // job pueda reusar esta misma forma sin abrir una segunda puerta de insert.
  attachmentR2Key?: string | null
  replyToMetaMessageId?: string | null
  createdAt: Date
}

// El `title` viaja adentro del jsonb y no en columna propia: solo lo traen unos
// pocos tipos (reel, post, fallback) y `buildInboundPushPayload` hace el split
// inverso exacto al armar el payload, así que lo guardado y lo pusheado son el
// mismo objeto. Solo se agrega la clave cuando hubo título.
function serializeAttachmentMeta(input: ProviderMessageInput): string | null {
  const attachment = input.attachment ?? null
  if (!attachment) return null
  return JSON.stringify(
    attachment.title
      ? { ...attachment.details, title: attachment.title }
      : attachment.details
  )
}

// La fila que ya estaba cuando el insert rebotó contra el dedupe. Se busca por
// dirección además de por wamid porque los dos índices únicos son parciales y
// disjuntos por `direction`: sin el filtro, el eco saliente encontraría el
// entrante del mismo wamid en una conversación de grupo.
async function findByMetaMessageId(input: {
  connectedPageId: string
  metaMessageId: string
  direction: MessageDirection
}) {
  const sql = getSql()
  const [row] = await sql<MessageRow[]>`
    select id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, origin, historical, delivery_status,
      attachment_status, attachment_r2_key, reply_to_meta_message_id,
      error, provider_response, created_at
    from messages
    where connected_page_id = ${input.connectedPageId}
      and meta_message_id = ${input.metaMessageId}
      and direction = ${input.direction}
    limit 1
  `

  return row ?? null
}

/**
 * El entrante: `direction='inbound'`, `status='received'`. Deduplica contra
 * `messages_inbound_meta_id_unique` (0001), que es solo-inbound.
 *
 * **La regla del `on conflict do update`: un mensaje histórico no puede pisar
 * a uno vivo.** El historial de Coexistence llega hasta 180 días después del
 * hecho y por chunks desordenados, así que el mismo wamid puede aparecer dos
 * veces —una en vivo y otra en el backfill— y en cualquier orden. El predicado
 * `where messages.historical` deja pasar exactamente dos casos:
 *
 * - la fila que ya estaba es histórica → se refresca (llegó el mismo mensaje
 *   otra vez, o llegó en vivo y **asciende**: pasa a `historical=false`, que es
 *   lo correcto porque el mensaje sí ocurrió dentro de Resender);
 * - la fila que ya estaba es viva → el update no toca ninguna fila, el
 *   `returning` vuelve vacío y el llamador lo trata como duplicado.
 *
 * Va en el `where` del `on conflict` y no en un `if` del llamador porque dos
 * requests concurrentes leerían las dos el estado viejo; adentro del UPDATE la
 * comparación la hace Postgres sobre la fila ya bloqueada.
 *
 * Para Messenger e Instagram el predicado es siempre falso (sus filas nacen con
 * `historical=false`), así que se comportan exactamente igual que con el
 * `do nothing` que había antes: 0 filas, `inserted: false`.
 */
export async function insertInboundMessage(input: ProviderMessageInput) {
  const sql = getSql()
  const attachment = input.attachment ?? null
  const attachmentMeta = serializeAttachmentMeta(input)

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
      origin,
      historical,
      delivery_status,
      attachment_status,
      attachment_r2_key,
      reply_to_meta_message_id,
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
      ${input.origin ?? null},
      ${input.historical ?? false},
      ${input.deliveryStatus ?? null},
      ${input.attachmentStatus ?? null},
      ${input.attachmentR2Key ?? null},
      ${input.replyToMetaMessageId ?? null},
      ${input.createdAt}
    )
    on conflict (connected_page_id, meta_message_id)
      where meta_message_id is not null and direction = 'inbound'
    do update set
      text = excluded.text,
      attachment_type = excluded.attachment_type,
      attachment_url = excluded.attachment_url,
      attachment_meta = excluded.attachment_meta,
      origin = excluded.origin,
      historical = excluded.historical,
      created_at = excluded.created_at,
      -- coalesce y no excluded a secas: el ascenso de histórico a vivo no trae
      -- estado de entrega ni media, y pisarlos con null borraría lo que el
      -- historial sí sabía y lo que el job de descarga ya escribió.
      delivery_status = coalesce(excluded.delivery_status, messages.delivery_status),
      attachment_status = coalesce(excluded.attachment_status, messages.attachment_status),
      attachment_r2_key = coalesce(excluded.attachment_r2_key, messages.attachment_r2_key),
      reply_to_meta_message_id = coalesce(excluded.reply_to_meta_message_id, messages.reply_to_meta_message_id)
    where messages.historical
    returning id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, origin, historical, delivery_status,
      attachment_status, attachment_r2_key, reply_to_meta_message_id,
      error, provider_response, created_at
  `

  if (row) return { message: mapMessage(row), inserted: true }

  if (input.metaMessageId) {
    const existing = await findByMetaMessageId({
      connectedPageId: input.connectedPageId,
      metaMessageId: input.metaMessageId,
      direction: "inbound",
    })

    if (existing) return { message: mapMessage(existing), inserted: false }
  }

  throw new Error("message insert failed")
}

/**
 * La mitad **saliente** de Coexistence: el eco de lo que el negocio tecleó en
 * la WhatsApp Business App y los mensajes salientes del historial importado.
 *
 * Es un insert aparte y no un parámetro de `insertInboundMessage` porque lo que
 * cambia es el índice único contra el que deduplica —`messages_coexistence_meta_id_unique`
 * (0017 §7), que cubre `direction='outbound' and origin in ('business_app','history')`—
 * y el `on conflict` no acepta que el predicado del índice sea un parámetro: el
 * driver HTTP de Neon no arma fragmentos `sql` anidados, así que el predicado
 * tiene que estar escrito literal en cada consulta.
 *
 * `status='sent'` y no `'received'`: el mensaje salió, aunque no lo mandáramos
 * nosotros. La diferencia entre "lo mandó Resender" y "lo mandó el negocio
 * desde su móvil" la lleva `origin`, que es justo para lo que existe.
 *
 * Misma regla del histórico que en el entrante, y por el mismo motivo.
 */
export async function insertCoexistenceMessage(input: ProviderMessageInput) {
  const sql = getSql()
  const attachment = input.attachment ?? null
  const attachmentMeta = serializeAttachmentMeta(input)

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
      origin,
      historical,
      delivery_status,
      attachment_status,
      attachment_r2_key,
      reply_to_meta_message_id,
      created_at
    )
    values (
      ${input.tenantId},
      ${input.conversationId},
      ${input.connectedPageId},
      ${input.contactId},
      'outbound',
      'sent',
      ${input.text},
      ${input.metaMessageId},
      ${attachment ? attachment.type : null},
      ${attachment ? attachment.url : null},
      ${attachmentMeta}::jsonb,
      ${input.origin ?? null},
      ${input.historical ?? false},
      ${input.deliveryStatus ?? null},
      ${input.attachmentStatus ?? null},
      ${input.attachmentR2Key ?? null},
      ${input.replyToMetaMessageId ?? null},
      ${input.createdAt}
    )
    on conflict (connected_page_id, meta_message_id)
      where meta_message_id is not null
        and direction = 'outbound'
        and origin in ('business_app', 'history')
    do update set
      text = excluded.text,
      attachment_type = excluded.attachment_type,
      attachment_url = excluded.attachment_url,
      attachment_meta = excluded.attachment_meta,
      origin = excluded.origin,
      historical = excluded.historical,
      created_at = excluded.created_at,
      delivery_status = coalesce(excluded.delivery_status, messages.delivery_status),
      attachment_status = coalesce(excluded.attachment_status, messages.attachment_status),
      attachment_r2_key = coalesce(excluded.attachment_r2_key, messages.attachment_r2_key),
      reply_to_meta_message_id = coalesce(excluded.reply_to_meta_message_id, messages.reply_to_meta_message_id)
    where messages.historical
    returning id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, origin, historical, delivery_status,
      attachment_status, attachment_r2_key, reply_to_meta_message_id,
      error, provider_response, created_at
  `

  if (row) return { message: mapMessage(row), inserted: true }

  if (input.metaMessageId) {
    const existing = await findByMetaMessageId({
      connectedPageId: input.connectedPageId,
      metaMessageId: input.metaMessageId,
      direction: "outbound",
    })

    if (existing) return { message: mapMessage(existing), inserted: false }
  }

  throw new Error("message insert failed")
}

/**
 * Mueve `delivery_status` con la monotonía de `lib/messages/delivery-status.ts`
 * en **un solo UPDATE que no lee primero**.
 *
 * Meta entrega los callbacks desordenados y los reintenta: dos del mismo wamid
 * pueden estar en vuelo a la vez. Un select-then-update pierde esa carrera —los
 * dos leen el estado viejo y gana el que escribe último, aunque sea el
 * atrasado—, así que el predicado viaja adentro del UPDATE y la comparación la
 * hace Postgres sobre la fila bloqueada.
 *
 * `overwritableBy` devuelve una **lista de valores** y no un fragmento `sql`
 * porque el driver HTTP de Neon no soporta `sql` anidado. El `is null` va
 * aparte porque `= any()` nunca da verdadero contra NULL.
 *
 * Devuelve si el callback ganó. `false` no es un error: es el callback atrasado
 * que se descarta, y el llamador lo registra con métrica.
 */
export async function updateDeliveryStatus(input: {
  connectedPageId: string
  metaMessageId: string
  deliveryStatus: DeliveryStatus
}): Promise<boolean> {
  const sql = getSql()
  const overwritable = overwritableBy(input.deliveryStatus)

  const rows = await sql<{ id: string }[]>`
    update messages
    set delivery_status = ${input.deliveryStatus}
    where connected_page_id = ${input.connectedPageId}
      and meta_message_id = ${input.metaMessageId}
      and (
        delivery_status is null
        or delivery_status = any(${overwritable as DeliveryStatus[]}::text[])
      )
    returning id
  `

  return rows.length > 0
}

export async function getConversationById(
  tenantId: string,
  conversationId: string
) {
  const sql = getSql()
  const [row] = await sql<ConversationRow[]>`
    select id, tenant_id, connected_page_id, contact_id, contact_name, last_message_at, last_inbound_at
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
  // Quién produjo el saliente (migración 0017). En Messenger e Instagram no hay
  // más que una respuesta posible y se puede omitir; en WhatsApp distingue lo
  // que mandó la API (`resender_api`) del eco de lo que el negocio tecleó en la
  // WhatsApp Business App (`business_app`), que llega como saliente pero no lo
  // enviamos nosotros.
  origin?: MessageOrigin | null
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
      origin,
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
      ${input.origin ?? null},
      ${input.error},
      ${providerResponse}::jsonb,
      ${input.createdAt}
    )
    returning id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, idempotency_key,
      instagram_source_comment_id, attachment_type, attachment_url,
      attachment_meta, origin, historical, delivery_status,
      attachment_status, attachment_r2_key, reply_to_meta_message_id,
      error, provider_response, created_at
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
      attachment_meta, origin, historical, delivery_status,
      attachment_status, attachment_r2_key, reply_to_meta_message_id,
      error, provider_response, created_at
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
      attachment_meta, origin, historical, delivery_status,
      attachment_status, attachment_r2_key, reply_to_meta_message_id,
      error, provider_response, created_at
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
    lastInboundAt: row.last_inbound_at,
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
    origin: row.origin ?? null,
    // `not null default false` en la 0017: la fila no puede decir "no consta".
    historical: row.historical === true,
    deliveryStatus: row.delivery_status ?? null,
    attachmentStatus: row.attachment_status ?? null,
    attachmentR2Key: row.attachment_r2_key ?? null,
    replyToMetaMessageId: row.reply_to_meta_message_id ?? null,
    error: row.error,
    providerResponse: row.provider_response,
    createdAt: row.created_at,
  }
}
