import type { MessageDto } from "@workspace/contracts"

export type ConversationListItem = {
  id: string
  contactId: string
  contactName: string | null
  lastMessageAt: Date
  page: {
    id: string
    metaPageId: string
    name: string
  }
  latestMessage: {
    text: string
    direction: MessageDto["direction"]
    status: MessageDto["status"]
    createdAt: Date
  } | null
}

export type ThreadMessage = {
  id: string
  direction: MessageDto["direction"]
  status: MessageDto["status"]
  text: string
  error: string | null
  createdAt: Date
}
