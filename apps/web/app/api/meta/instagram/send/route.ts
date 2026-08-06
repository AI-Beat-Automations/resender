import { type NextRequest } from "next/server"

import { authenticateApiKey } from "@/lib/api-keys/api-keys"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  getConversationById,
  getOutboundMessageByIdempotencyKey,
  insertOutboundMessage,
  upsertConversation,
  type MessageRecord,
} from "@/lib/messages/message-log"
import {
  exceedsInstagramTextLimit,
  extractMetaMessageId,
  instagramTextByteLength,
  INSTAGRAM_TEXT_MAX_BYTES,
  isMetaExpiredTokenError,
  sendInstagramTextMessage,
} from "@/lib/outbound/instagram-send"
import {
  getBearerToken,
  parseOutboundSendInput,
} from "@/lib/outbound/send-request"
import {
  getActivePageWithTokenForTenant,
  markPageTokenInvalid,
} from "@/lib/pages/page-registry"
import { posthog } from "@/lib/posthog"

// Envía un mensaje directo por Instagram.
// Body: { pageId, recipientId, reply, conversationId? }.
// Header opcional `Idempotency-Key`: si se repite, se devuelve el resultado
// almacenado sin reenviar a Meta.
//
// El body es el mismo que el de Messenger a propósito: `pageId` es "la cuenta
// conectada desde la que sale el mensaje" —acá el IG ID de la cuenta
// profesional— y es la misma columna (`connected_pages.meta_page_id`) en los
// dos canales. Un cliente que atiende ambos cambia la URL y nada más. El nombre
// se lee raro en Instagram; el costo de que fueran dos contratos distintos es
// peor.
//
// El token de la cuenta se resuelve en el servidor por `pageId` y nunca viaja
// en la request, igual que en Messenger.
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

  // El replay idempotente se resuelve antes que nada: no llama a Meta ni
  // inserta, así que devolver el resultado ya almacenado es lo único correcto.
  if (idempotencyKey) {
    const replay = await getOutboundMessageByIdempotencyKey(
      apiKey.tenantId,
      idempotencyKey
    )
    if (replay) return idempotentReplayResponse(replay)
  }

  // Acá NO va el gate de entitlement. Instagram está fuera de cuota y fuera del
  // cupo de páginas por ahora, así que no hay período que resolver ni contador
  // que consultar; el gate de suscripción activa, que sí aplica, ya pasó arriba.
  // Cuando Instagram entre en la facturación, este es el punto donde vuelve el
  // bloque `getTenantEntitlement` de `/api/meta/send`.

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

  // Se valida el largo antes de llamar a Meta: el rechazo de Instagram por
  // pasarse no dice cuánto sobró, y un 400 nuestro con el número exacto evita
  // que el cliente tenga que adivinar. Se cuenta en bytes UTF-8 y no en
  // caracteres porque así lo mide Instagram — en español la diferencia es real.
  if (exceedsInstagramTextLimit(input.value.reply)) {
    return Response.json(
      {
        error: `reply is too long: Instagram allows ${INSTAGRAM_TEXT_MAX_BYTES} UTF-8 bytes and this message is ${instagramTextByteLength(
          input.value.reply
        )}`,
      },
      { status: 400 }
    )
  }

  const connectedPage = await getActivePageWithTokenForTenant(
    apiKey.tenantId,
    input.value.pageId,
    "instagram"
  )
  if (!connectedPage) {
    return Response.json(
      {
        error: "Instagram account is not connected for this tenant",
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
  // Sin `pageId`: el endpoint de Instagram es `/me/messages` y la cuenta sale
  // del token.
  const metaResult = await sendInstagramTextMessage({
    accessToken: connectedPage.pageAccessToken,
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
          "Meta rejected the Instagram token. Reconnect the account in Resender.",
      })
    } catch (error) {
      console.error(
        "failed to mark instagram token invalid",
        connectedPage.page.metaPageId,
        error
      )
    }
  }

  let message: MessageRecord
  try {
    // El mensaje se persiste tanto si Meta lo aceptó como si lo rechazó: el
    // rechazo por ventana cerrada es el caso más común de Instagram y es
    // justamente el que el usuario necesita poder ver en el log.
    message = await insertOutboundMessage({
      tenantId: apiKey.tenantId,
      conversationId: conversation.id,
      connectedPageId: connectedPage.page.id,
      contactId: input.value.recipientId,
      text: input.value.reply,
      status: metaResult.ok ? "sent" : "failed",
      metaMessageId: extractMetaMessageId(metaResult.data),
      idempotencyKey,
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

  // Sin `incrementUsage`: Instagram no consume cuota. Es la contracara de que
  // tampoco lo frene el bloqueo por cuota agotada.

  if (posthog) {
    posthog.capture({
      distinctId: apiKey.tenantId,
      event: "message sent",
      properties: {
        message_id: message.id,
        conversation_id: conversation.id,
        page_id: input.value.pageId,
        channel: "instagram",
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
