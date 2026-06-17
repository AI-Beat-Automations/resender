import { type NextRequest } from "next/server"

import { authenticateApiKey } from "@/lib/api-keys/api-keys"
import {
  getConversationById,
  insertOutboundMessage,
  upsertConversation,
} from "@/lib/messages/message-log"
import { getActivePageWithTokenForTenant } from "@/lib/pages/page-registry"
import { extractMetaMessageId, sendMetaTextMessage } from "@/lib/outbound/meta-send"
import { getBearerToken, parseOutboundSendInput } from "@/lib/outbound/send-request"

// Envía una respuesta al contacto.
// Body: { pageId, recipientId, reply, conversationId? }.
// El page access token se resuelve en el servidor por pageId (no viaja en el curl).
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const bearer = getBearerToken(request.headers.get("authorization"))
  const apiKey = await authenticateApiKey(bearer)
  if (!apiKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const input = parseOutboundSendInput(body)
  if (!input.ok) {
    return Response.json({ error: input.error }, { status: 400 })
  }

  const connectedPage = await getActivePageWithTokenForTenant(
    apiKey.tenantId,
    input.value.pageId
  )
  if (!connectedPage) {
    return Response.json(
      {
        error: "page is not connected for this tenant",
      },
      { status: 404 }
    )
  }

  let conversation = input.value.conversationId
    ? await getConversationById(apiKey.tenantId, input.value.conversationId)
    : null

  if (input.value.conversationId) {
    if (
      !conversation ||
      conversation.connectedPageId !== connectedPage.page.id ||
      conversation.contactId !== input.value.recipientId
    ) {
      return Response.json(
        { error: "conversationId does not match pageId and recipientId" },
        { status: 400 }
      )
    }
  } else {
    conversation = await upsertConversation({
      tenantId: apiKey.tenantId,
      connectedPageId: connectedPage.page.id,
      contactId: input.value.recipientId,
      lastMessageAt: new Date(),
    })
  }

  if (!conversation) {
    return Response.json({ error: "conversation not found" }, { status: 400 })
  }

  const sentAt = new Date()
  const metaResult = await sendMetaTextMessage({
    pageId: input.value.pageId,
    pageAccessToken: connectedPage.pageAccessToken,
    recipientId: input.value.recipientId,
    text: input.value.reply,
  })

  const message = await insertOutboundMessage({
    tenantId: apiKey.tenantId,
    conversationId: conversation.id,
    connectedPageId: connectedPage.page.id,
    contactId: input.value.recipientId,
    text: input.value.reply,
    status: metaResult.ok ? "sent" : "failed",
    metaMessageId: extractMetaMessageId(metaResult.data),
    error: metaResult.error,
    providerResponse: metaResult.data,
    createdAt: sentAt,
  })

  return Response.json(
    {
      meta: metaResult.data,
      echo: {
        conversationId: conversation.id,
        messageId: message.id,
        status: message.status,
      },
    },
    { status: metaResult.status }
  )
}
