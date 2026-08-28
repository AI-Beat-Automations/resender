import { getSql } from "@/lib/db"
import type { PageChannel } from "@/lib/pages/page-registry"

import type { MessageDirection, MessageStatus } from "./message-log"
import type { AttachmentStatus, DeliveryStatus } from "./message-enums"

export type ConversationListItem = {
  id: string
  contactId: string
  // Resueltos contra Graph y cacheados (migración 0014); null mientras nadie
  // haya mirado la conversación, o si Graph no supo resolver el contacto.
  contactName: string | null
  contactUsername: string | null
  contactSyncedAt: Date | null
  lastMessageAt: Date
  // `messages` no tiene columna `channel` a propósito: el canal vive en
  // `connected_pages` y se resuelve en este join, una vez por conversación.
  page: {
    id: string
    channel: PageChannel
    metaPageId: string
    name: string
    username: string | null
    // El número en formato humano (migración 0017). En WhatsApp `metaPageId` es
    // el `phone_number_id`, que no dice qué número es: sin esta columna el log
    // identificaría la cuenta por un entero opaco.
    whatsappPhoneE164: string | null
  }
  latestMessage: {
    text: string
    direction: MessageDirection
    status: MessageStatus
    createdAt: Date
    // Solo el type: el renglón de la lista lo muestra entre corchetes cuando
    // el mensaje no trae texto; la URL y el meta solo importan en el hilo.
    attachmentType: string | null
    // Un envío de [Plantilla] (0018) no trae ni texto ni adjunto: sin esta
    // columna el renglón de la lista se quedaría en un «Tú: » a secas, que es
    // la misma burbuja vacía que el hilo tiene prohibido mostrar.
    templateMeta: Record<string, unknown> | null
  } | null
}

export type ThreadMessage = {
  id: string
  // Denormalizado desde `connected_pages`: todas las filas del hilo comparten
  // canal, pero llevarlo en la fila deja a `toThreadMessageViews` puro — no
  // tiene que recibir el hilo y el canal por separado y confiar en que casen.
  channel: PageChannel
  direction: MessageDirection
  status: MessageStatus
  text: string
  error: string | null
  // Informado solo en la respuesta privada a un comentario de Instagram: es un
  // DM como cualquier otro y esta columna es lo único que lo distingue.
  instagramSourceCommentId: string | null
  // Adjunto tal como se persistió (migración de #46): el mapeo a preview o
  // fila lo hace `toAttachmentDisplay`, no el read model.
  attachmentType: string | null
  attachmentUrl: string | null
  attachmentMeta: Record<string, unknown> | null
  // Ciclo de vida del binario en R2 (0017). Solo WhatsApp lo informa; en
  // Messenger e Instagram es null porque no hospedamos nada.
  attachmentStatus: AttachmentStatus | null
  // El wamid propio y el del mensaje al que este responde o reacciona. Es lo
  // único que permite colgar una reacción del mensaje correcto: la reacción
  // llega como un mensaje suelto que apunta por id, no por conversación.
  metaMessageId: string | null
  replyToMetaMessageId: string | null
  // Lo que reporta Meta sobre la entrega, **distinto** del `status` interno:
  // «lo aceptamos y lo mandamos» y «el destinatario lo leyó» son dos hechos y
  // mezclarlos en una columna pierde uno de los dos.
  deliveryStatus: DeliveryStatus | null
  // Lo que se envió en un envío de [Plantilla] (`template_meta`, 0018): nombre,
  // idioma y los `components` **de ese envío**. La fila viene con `text = ''` y
  // sin adjunto, así que esta columna es todo el contenido que hay; sin ella la
  // burbuja sale en blanco (ADR 0014). Se deja como jsonb crudo y la lectura la
  // hace `toTemplateDisplay`: el read model no interpreta contenido.
  templateMeta: Record<string, unknown> | null
  createdAt: Date
}

type ConversationListRow = {
  id: string
  contact_id: string
  contact_name: string | null
  contact_username: string | null
  contact_synced_at: Date | null
  last_message_at: Date
  page_id: string
  page_channel: PageChannel
  meta_page_id: string
  page_name: string
  page_username: string | null
  page_whatsapp_phone_e164: string | null
  latest_text: string | null
  latest_direction: MessageDirection | null
  latest_status: MessageStatus | null
  latest_created_at: Date | null
  latest_attachment_type: string | null
  latest_template_meta: unknown
}

type ThreadMessageRow = {
  id: string
  page_channel: PageChannel
  direction: MessageDirection
  status: MessageStatus
  // Nullable en DB desde que un mensaje puede ser solo adjunto; el read model
  // lo normaliza a `""` para no propagar el null a las vistas.
  text: string | null
  error: string | null
  instagram_source_comment_id: string | null
  attachment_type: string | null
  attachment_url: string | null
  attachment_meta: unknown
  attachment_status: AttachmentStatus | null
  meta_message_id: string | null
  reply_to_meta_message_id: string | null
  delivery_status: DeliveryStatus | null
  template_meta: unknown
  created_at: Date
}

export async function listConversationReadModel(input: {
  tenantId: string
  connectedPageId?: string
}) {
  const sql = getSql()
  const rows = await sql<ConversationListRow[]>`
    select
      c.id,
      c.contact_id,
      c.contact_name,
      c.contact_username,
      c.contact_synced_at,
      c.last_message_at,
      p.id as page_id,
      p.channel as page_channel,
      p.meta_page_id,
      p.name as page_name,
      p.username as page_username,
      p.whatsapp_phone_e164 as page_whatsapp_phone_e164,
      latest.text as latest_text,
      latest.direction as latest_direction,
      latest.status as latest_status,
      latest.created_at as latest_created_at,
      latest.attachment_type as latest_attachment_type,
      latest.template_meta as latest_template_meta
    from conversations c
    join connected_pages p on p.id = c.connected_page_id
    left join lateral (
      select text, direction, status, created_at, attachment_type, template_meta
      from messages m
      where m.conversation_id = c.id
        and m.tenant_id = c.tenant_id
      order by m.created_at desc
      limit 1
    ) latest on true
    where c.tenant_id = ${input.tenantId}
      and (${input.connectedPageId ?? null}::uuid is null or c.connected_page_id = ${input.connectedPageId ?? null}::uuid)
    order by c.last_message_at desc
  `

  return rows.map(mapConversationListItem)
}

export async function listThreadMessages(input: {
  tenantId: string
  conversationId: string
}) {
  const sql = getSql()
  // El join con `connected_pages` trae el canal, que es lo que decide de dónde
  // sale la URL del adjunto: el CDN de Meta en Messenger e Instagram, la ruta
  // propia en WhatsApp. Es una fila por hilo, no por mensaje.
  const rows = await sql<ThreadMessageRow[]>`
    select m.id, m.direction, m.status, m.text, m.error,
           m.instagram_source_comment_id,
           m.attachment_type, m.attachment_url, m.attachment_meta,
           m.attachment_status, m.meta_message_id, m.reply_to_meta_message_id,
           m.delivery_status, m.template_meta, m.created_at,
           p.channel as page_channel
    from messages m
    join connected_pages p on p.id = m.connected_page_id
    where m.tenant_id = ${input.tenantId}
      and m.conversation_id = ${input.conversationId}
    order by m.created_at asc
  `

  return rows.map((row) => ({
    id: row.id,
    channel: row.page_channel,
    direction: row.direction,
    status: row.status,
    // Un mensaje solo-adjunto puede venir con text null: se normaliza a ""
    // para que las vistas sigan tratando `text` como string a secas.
    text: row.text ?? "",
    error: row.error,
    instagramSourceCommentId: row.instagram_source_comment_id,
    attachmentType: row.attachment_type,
    attachmentUrl: row.attachment_url,
    attachmentMeta: asJsonObject(row.attachment_meta),
    attachmentStatus: row.attachment_status,
    metaMessageId: row.meta_message_id,
    replyToMetaMessageId: row.reply_to_meta_message_id,
    deliveryStatus: row.delivery_status,
    templateMeta: asJsonObject(row.template_meta),
    createdAt: row.created_at,
  }))
}

function mapConversationListItem(
  row: ConversationListRow
): ConversationListItem {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactUsername: row.contact_username,
    contactSyncedAt: row.contact_synced_at,
    lastMessageAt: row.last_message_at,
    page: {
      id: row.page_id,
      channel: row.page_channel,
      metaPageId: row.meta_page_id,
      name: row.page_name,
      username: row.page_username,
      whatsappPhoneE164: row.page_whatsapp_phone_e164,
    },
    // Ojo: el guard ya no incluye `latest_text` — un mensaje solo-adjunto
    // viene con texto vacío o null y sigue siendo el último mensaje real.
    latestMessage:
      row.latest_direction && row.latest_status && row.latest_created_at
        ? {
            text: row.latest_text ?? "",
            direction: row.latest_direction,
            status: row.latest_status,
            createdAt: row.latest_created_at,
            attachmentType: row.latest_attachment_type,
            templateMeta: asJsonObject(row.latest_template_meta),
          }
        : null,
  }
}

// jsonb llega ya parseado con el driver HTTP de Neon, pero otros drivers (o
// un fixture) pueden entregarlo como string: el cast defensivo evita que un
// metadato raro rompa el hilo entero — un meta ilegible se pinta como nada.
function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
