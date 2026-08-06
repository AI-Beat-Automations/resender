import { type NextRequest } from "next/server"

import { authenticateApiKey } from "@/lib/api-keys/api-keys"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { incrementUsage } from "@/lib/billing/usage-counter"
import {
  getConversationById,
  getOutboundMessageByIdempotencyKey,
  insertOutboundMessage,
  upsertConversation,
  type MessageRecord,
} from "@/lib/messages/message-log"
import {
  getActivePageWithTokenForTenant,
  markPageTokenInvalid,
} from "@/lib/pages/page-registry"
import {
  extractMetaMessageId,
  isMetaExpiredTokenError,
  sendMetaTextMessage,
} from "@/lib/outbound/meta-send"
import {
  getBearerToken,
  parseOutboundSendInput,
} from "@/lib/outbound/send-request"
import { posthog } from "@/lib/posthog"

// Envía una respuesta al contacto.
// Body: { pageId, recipientId, reply, conversationId? }.
// Header opcional `Idempotency-Key`: si se repite, se devuelve el resultado
// almacenado sin reenviar a Meta.
// El page access token se resuelve en el servidor por pageId (no viaja en el curl).
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const bearer = getBearerToken(request.headers.get("authorization"))
  const apiKey = await authenticateApiKey(bearer)
  if (!apiKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const idempotencyHeader = request.headers.get("idempotency-key")
  const idempotencyKey = idempotencyHeader?.trim() ?? null
  if (
    idempotencyHeader !== null &&
    (!idempotencyKey || idempotencyKey.length > 200)
  ) {
    return Response.json(
      {
        error:
          "Idempotency-Key must be a non-empty string of at most 200 characters",
      },
      { status: 400 }
    )
  }

  if (await isUserWaitlisted(apiKey.tenantId)) {
    return Response.json(
      { error: "account is on the waitlist" },
      { status: 403 }
    )
  }

  if (!(await hasActiveSubscription(apiKey.tenantId))) {
    return Response.json({ error: "no active subscription" }, { status: 403 })
  }

  // El replay idempotente se resuelve ANTES del gate de cuota: no llama a Meta
  // ni inserta nada, así que no consume cuota, y devolver el resultado ya
  // almacenado es lo único correcto. Bloquearlo con 402 le diría al cliente que
  // falló un mensaje que Meta ya entregó, justo en el reintento agresivo que la
  // Idempotency-Key existe para hacer seguro.
  if (idempotencyKey) {
    const replay = await getOutboundMessageByIdempotencyKey(
      apiKey.tenantId,
      idempotencyKey
    )
    if (replay) return idempotentReplayResponse(replay)
  }

  // Tercer gate en serie (ADR 0003): con la cuota del período agotada o con
  // más páginas conectadas de las que permite el plan, la cuenta queda
  // restringida y no envía por ninguna de sus páginas.
  const { block, periodStart } = await getTenantEntitlement(apiKey.tenantId)
  // Un período sin resolver siempre viene acompañado de `block` (el módulo
  // puro es fail-closed); comprobar ambos es lo que estrecha el tipo de
  // `periodStart` hasta el incremento del contador, sin recurrir a `!`.
  if (block || !periodStart) {
    return Response.json(
      {
        error: block?.code ?? "plan_unavailable",
        message:
          block?.message ??
          "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
      },
      { status: block?.status ?? 403 }
    )
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

  // Canal explícito: este endpoint es el de Messenger. Instagram tiene el suyo
  // en `/api/meta/instagram/send`, y desde la migración 0013 el mismo
  // `meta_page_id` puede existir en los dos canales.
  const connectedPage = await getActivePageWithTokenForTenant(
    apiKey.tenantId,
    input.value.pageId,
    "messenger"
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

  if (!metaResult.ok && isMetaExpiredTokenError(metaResult.data)) {
    try {
      await markPageTokenInvalid({
        tenantId: apiKey.tenantId,
        connectionId: connectedPage.page.id,
        error:
          metaResult.error ??
          "Meta rejected the Page token. Reconnect the Page in Resender.",
      })
    } catch (error) {
      console.error(
        "failed to mark page token invalid",
        connectedPage.page.metaPageId,
        error
      )
    }
  }

  let message: MessageRecord
  try {
    message = await insertOutboundMessage({
      tenantId: apiKey.tenantId,
      conversationId: conversation.id,
      connectedPageId: connectedPage.page.id,
      contactId: input.value.recipientId,
      text: input.value.reply,
      status: metaResult.ok ? "sent" : "failed",
      metaMessageId: extractMetaMessageId(metaResult.data),
      idempotencyKey,
      // Se persiste el motivo traducido; el error crudo de Meta queda en
      // provider_response.
      error: metaResult.reason ?? metaResult.error,
      providerResponse: metaResult.data,
      createdAt: sentAt,
    })
  } catch (error) {
    // Carrera de dos requests con la misma Idempotency-Key: el índice único
    // rechaza el segundo insert y devolvemos el mensaje ya almacenado.
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await getOutboundMessageByIdempotencyKey(
        apiKey.tenantId,
        idempotencyKey
      )
      if (existing) return idempotentReplayResponse(existing)
    }
    throw error
  }

  // Solo consume cuota la respuesta que Meta aceptó: el cliente no paga por un
  // page token vencido nuestro ni por la ventana de 24h de Messenger. Los
  // replays idempotentes ya devolvieron antes de llegar acá, así que tampoco
  // suman. Best-effort: un fallo del contador no puede hacer fallar un mensaje
  // que Meta ya entregó.
  if (metaResult.ok) {
    try {
      await incrementUsage(apiKey.tenantId, periodStart)
    } catch (error) {
      console.error("failed to increment usage counter", apiKey.tenantId, error)
    }
  }

  if (posthog) {
    posthog.capture({
      distinctId: apiKey.tenantId,
      event: "message sent",
      properties: {
        message_id: message.id,
        conversation_id: conversation.id,
        page_id: input.value.pageId,
        status: message.status,
        meta_ok: metaResult.ok,
      },
    })
    await posthog.flush()
  }

  return Response.json(
    {
      ...(metaResult.ok
        ? {}
        : { error: metaResult.reason ?? metaResult.error }),
      meta: metaResult.data,
      resender: {
        conversationId: conversation.id,
        messageId: message.id,
        status: message.status,
      },
    },
    { status: metaResult.status }
  )
}

function idempotentReplayResponse(message: MessageRecord) {
  return Response.json({
    ...(message.status === "failed" && message.error
      ? { error: message.error }
      : {}),
    meta: message.providerResponse,
    resender: {
      conversationId: message.conversationId,
      messageId: message.id,
      status: message.status,
      idempotentReplay: true,
    },
  })
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}
