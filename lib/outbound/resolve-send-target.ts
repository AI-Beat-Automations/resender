import {
  getConversationById,
  upsertConversation,
  type ConversationRecord,
} from "@/lib/messages/message-log"
import type { LogReason } from "@/lib/observability/logger"
import type { SendTarget } from "@/lib/outbound/send-request"
import {
  getActivePageWithTokenByConnectionId,
  getActivePageWithTokenForTenant,
  type ConnectedPageRecord,
  type PageChannel,
} from "@/lib/pages/page-registry"

// Resuelve el destino de un envío (ADR 0019) a la cuenta conectada, su token y
// la conversación, en cualquiera de las dos formas que acepta el body:
//
// - `conversation`: el `conversation.id` del push. La fila de `conversations`
//   ya trae `connected_page_id` y `contact_id`, así que de ahí salen la página
//   y el destinatario; el canal de la página tiene que ser el de la ruta.
// - `contact`: `pageId` (= `meta_page_id`) + `recipientId`, el modo de inicio y
//   el de los clientes anteriores. Es lo que hacían las tres rutas inline: se
//   busca la cuenta por `(tenant, meta_page_id, canal)` y se hace upsert de la
//   conversación, o se verifica la coincidencia si vino `conversationId`.
//
// Las tres rutas de DM comparten esta función para que las dos formas se
// comporten igual en los tres canales; lo que cambia por canal (el texto del
// 404 de cuenta y la ruta a sugerir) está en las tablas de abajo.
export type ResolvedSendTarget = {
  page: ConnectedPageRecord
  pageAccessToken: string
  conversation: ConversationRecord
}

export type ResolveSendTargetError = {
  ok: false
  status: 400 | 404
  code?: "conversation_channel_mismatch"
  error: string
  // Para `trace.drop`: la razón del log y el detalle que hoy loguean las rutas
  // (`accountId=…` / `phoneNumberId=…`), sin que la ruta tenga que rearmarlos.
  reason: LogReason
  errorMessage?: string
}

export type ResolveSendTargetResult =
  | { ok: true; value: ResolvedSendTarget }
  | ResolveSendTargetError

const PAGE_NOT_CONNECTED_ERROR: Record<PageChannel, string> = {
  messenger: "page is not connected for this tenant",
  instagram: "Instagram account is not connected for this tenant",
  whatsapp: "WhatsApp number is not connected for this tenant",
}

// Cómo se llama el `meta_page_id` en el log de cada canal, igual que antes.
const ACCOUNT_LOG_FIELD: Record<PageChannel, string> = {
  messenger: "accountId",
  instagram: "accountId",
  whatsapp: "phoneNumberId",
}

const SEND_ROUTE: Record<PageChannel, string> = {
  messenger: "/api/meta/send",
  instagram: "/api/meta/instagram/send",
  whatsapp: "/api/meta/whatsapp/send",
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export async function resolveSendTarget(input: {
  tenantId: string
  channel: PageChannel
  target: SendTarget
}): Promise<ResolveSendTargetResult> {
  const { tenantId, channel, target } = input

  if (target.kind === "conversation") {
    // `conversations.id` es uuid: un valor con otra forma (el `metaMessageId`,
    // el `contactId`…) haría que Postgres rechace la query con un 500. Es el
    // mismo 404 que una conversación ajena: no existe para este tenant.
    const conversation = isUuid(target.conversationId)
      ? await getConversationById(tenantId, target.conversationId)
      : null
    if (!conversation) {
      return {
        ok: false,
        status: 404,
        error: "conversation not found",
        reason: "conversation_not_found",
        errorMessage: `conversationId=${target.conversationId}`,
      }
    }

    // Por id de conexión y no por `meta_page_id`: la conversación ya sabe de
    // qué cuenta es. Sin filtrar por canal, para poder decirle al cliente a qué
    // ruta tenía que ir en vez de un 404 que lo deje adivinando.
    const connectedPage = await getActivePageWithTokenByConnectionId(
      tenantId,
      conversation.connectedPageId
    )
    if (!connectedPage) {
      return {
        ok: false,
        status: 404,
        error: PAGE_NOT_CONNECTED_ERROR[channel],
        reason: "page_not_connected",
        errorMessage: `connectionId=${conversation.connectedPageId}`,
      }
    }

    if (connectedPage.page.channel !== channel) {
      return {
        ok: false,
        status: 400,
        code: "conversation_channel_mismatch",
        error: `conversation belongs to ${connectedPage.page.channel}; use ${SEND_ROUTE[connectedPage.page.channel]}`,
        reason: "invalid_request",
      }
    }

    return {
      ok: true,
      value: {
        page: connectedPage.page,
        pageAccessToken: connectedPage.pageAccessToken,
        conversation,
      },
    }
  }

  // Modo `contact`. El canal va explícito: `meta_page_id` es único por
  // `(channel, meta_page_id)` desde la migración 0013, así que buscar sin canal
  // puede traer la fila de otro.
  const connectedPage = await getActivePageWithTokenForTenant(
    tenantId,
    target.pageId,
    channel
  )
  if (!connectedPage) {
    return {
      ok: false,
      status: 404,
      error: PAGE_NOT_CONNECTED_ERROR[channel],
      reason: "page_not_connected",
      errorMessage: `${ACCOUNT_LOG_FIELD[channel]}=${target.pageId}`,
    }
  }

  let conversation: ConversationRecord | null
  if (target.conversationId) {
    // Los tres campos juntos tienen que contar la misma historia. Una
    // conversación desconocida cae acá y no en 404, como siempre en esta forma:
    // el cliente mandó un par válido y un id que no le corresponde.
    conversation = isUuid(target.conversationId)
      ? await getConversationById(tenantId, target.conversationId)
      : null
    if (
      !conversation ||
      conversation.connectedPageId !== connectedPage.page.id ||
      conversation.contactId !== target.recipientId
    ) {
      return {
        ok: false,
        status: 400,
        error: "conversationId does not match pageId and recipientId",
        reason: "invalid_request",
      }
    }
  } else {
    // Sin `message`, así que este upsert **no** mueve `last_inbound_at`: un
    // saliente nuestro no abre la ventana de 24 h. La fila que nace acá para un
    // contacto nuevo queda con `last_inbound_at` null, que es exactamente la
    // semántica de WhatsApp: al primer contacto no se le escribe sin plantilla.
    conversation = await upsertConversation({
      tenantId,
      connectedPageId: connectedPage.page.id,
      contactId: target.recipientId,
      lastMessageAt: new Date(),
    })
  }

  return {
    ok: true,
    value: {
      page: connectedPage.page,
      pageAccessToken: connectedPage.pageAccessToken,
      conversation,
    },
  }
}
