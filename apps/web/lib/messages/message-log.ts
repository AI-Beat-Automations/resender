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
  error: string | null
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
  error: string | null
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
  createdAt: Date
}) {
  const sql = getSql()

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
      ${input.createdAt}
    )
    on conflict (connected_page_id, meta_message_id)
      where meta_message_id is not null and direction = 'inbound'
    do nothing
    returning id, tenant_id, conversation_id, connected_page_id, contact_id,
      direction, status, text, meta_message_id, error, created_at
  `

  if (row) return { message: mapMessage(row), inserted: true }

  if (input.metaMessageId) {
    const [existing] = await sql<MessageRow[]>`
      select id, tenant_id, conversation_id, connected_page_id, contact_id,
        direction, status, text, meta_message_id, error, created_at
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
    text: row.text,
    metaMessageId: row.meta_message_id,
    error: row.error,
    createdAt: row.created_at,
  }
}
