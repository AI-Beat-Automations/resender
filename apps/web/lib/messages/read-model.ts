import { getSql } from "@/lib/db"
import type { PageChannel } from "@/lib/pages/page-registry"

import type { MessageDirection, MessageStatus } from "./message-log"

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
  }
  latestMessage: {
    text: string
    direction: MessageDirection
    status: MessageStatus
    createdAt: Date
  } | null
}

export type ThreadMessage = {
  id: string
  direction: MessageDirection
  status: MessageStatus
  text: string
  error: string | null
  // Informado solo en la respuesta privada a un comentario de Instagram: es un
  // DM como cualquier otro y esta columna es lo único que lo distingue.
  instagramSourceCommentId: string | null
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
  latest_text: string | null
  latest_direction: MessageDirection | null
  latest_status: MessageStatus | null
  latest_created_at: Date | null
}

type ThreadMessageRow = {
  id: string
  direction: MessageDirection
  status: MessageStatus
  text: string
  error: string | null
  instagram_source_comment_id: string | null
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
      latest.text as latest_text,
      latest.direction as latest_direction,
      latest.status as latest_status,
      latest.created_at as latest_created_at
    from conversations c
    join connected_pages p on p.id = c.connected_page_id
    left join lateral (
      select text, direction, status, created_at
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
  const rows = await sql<ThreadMessageRow[]>`
    select id, direction, status, text, error,
           instagram_source_comment_id, created_at
    from messages
    where tenant_id = ${input.tenantId}
      and conversation_id = ${input.conversationId}
    order by created_at asc
  `

  return rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    status: row.status,
    text: row.text,
    error: row.error,
    instagramSourceCommentId: row.instagram_source_comment_id,
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
    },
    latestMessage:
      row.latest_text &&
      row.latest_direction &&
      row.latest_status &&
      row.latest_created_at
        ? {
            text: row.latest_text,
            direction: row.latest_direction,
            status: row.latest_status,
            createdAt: row.latest_created_at,
          }
        : null,
  }
}
