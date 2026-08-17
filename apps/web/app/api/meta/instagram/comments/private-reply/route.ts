import { type NextRequest } from "next/server"

import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { incrementUsage } from "@/lib/billing/usage-counter"
import {
  getOutboundMessageByIdempotencyKey,
  getPrivateReplyForComment,
  insertOutboundMessage,
  upsertConversation,
  type MessageRecord,
} from "@/lib/messages/message-log"
import {
  authenticateCommentReplyRequest,
  isUniqueViolation,
  resolveCommentReplyTarget,
} from "@/lib/outbound/comment-reply-request"
import { sendInstagramPrivateReply } from "@/lib/outbound/instagram-comment-reply"
import {
  exceedsInstagramTextLimit,
  extractMetaMessageId,
  instagramTextByteLength,
  INSTAGRAM_TEXT_MAX_BYTES,
  isMetaExpiredTokenError,
} from "@/lib/outbound/instagram-send"
import { parseCommentReplyInput } from "@/lib/outbound/send-request"
import { markPageTokenInvalid } from "@/lib/pages/page-registry"
import { describeError, log } from "@/lib/observability/logger"
import {
  outboundLogger,
  resolveRequestId,
} from "@/lib/observability/outbound-log"
import { posthog } from "@/lib/posthog"

// Manda un **DM privado a quien comentó**, amparado en el comentario.
// Body: { pageId, commentId, reply }.
// Header opcional `Idempotency-Key`.
//
// Es la única forma de escribirle primero a alguien que nunca mandó un DM: la
// ventana de 24 horas de la mensajería normal no aplica, y en su lugar rigen
// dos reglas de Meta que esta ruta hace explícitas:
//
// - **7 días** desde que se hizo el comentario.
// - **Una sola** respuesta privada por comentario.
//
// El resultado se persiste en `messages` y no en `instagram_comments`, porque
// es un DM: lo único que lo distingue de uno normal es la columna
// `instagram_source_comment_id`, que guarda el comentario que lo originó.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "comment_private_reply",
    channel: "instagram",
    subject: "comment",
    requestId,
  })

  const auth = await authenticateCommentReplyRequest(request)
  // El motivo lo trae el gate compartido; la `action` la pone la ruta, que es
  // la única que sabe si esto es una respuesta pública o un DM privado.
  if (!auth.ok) return trace.drop(auth.reason, auth.response)
  const { tenantId, idempotencyKey } = auth.value
  trace.setTenant(tenantId)

  if (idempotencyKey) {
    const replay = await getOutboundMessageByIdempotencyKey(
      tenantId,
      idempotencyKey
    )
    if (replay) {
      return trace.duplicate(idempotentReplayResponse(replay), {
        subjectId: replay.id,
      })
    }
  }

  // Gate de entitlement (ADR 0003), en el mismo lugar que en `/api/meta/send`:
  // después del replay, que no llama a Meta ni inserta. Con la cuota agotada o
  // con más conexiones de las que permite el plan, la cuenta queda restringida
  // y tampoco manda respuestas privadas (ADR 0011).
  const { block, periodStart } = await getTenantEntitlement(tenantId)
  // Un período sin resolver siempre viene acompañado de `block` (el módulo puro
  // es fail-closed); comprobar ambos es lo que estrecha el tipo de
  // `periodStart` hasta el incremento del contador, sin recurrir a `!`.
  if (block || !periodStart) {
    return trace.drop(
      "plan_restricted",
      Response.json(
        {
          error: block?.code ?? "plan_unavailable",
          message:
            block?.message ??
            "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
        },
        { status: block?.status ?? 403 }
      ),
      { errorCode: block?.code ?? "plan_unavailable" }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "invalid json" }, { status: 400 })
    )
  }

  const input = parseCommentReplyInput(body)
  if (!input.ok) {
    return trace.drop(
      "invalid_request",
      Response.json({ error: input.error }, { status: 400 })
    )
  }

  // Es un DM, así que rige el límite del DM: 1000 **bytes** UTF-8, no los 2200
  // caracteres de un comentario.
  if (exceedsInstagramTextLimit(input.value.reply)) {
    return trace.drop(
      "reply_too_long",
      Response.json(
        {
          error: `reply is too long: Instagram allows ${INSTAGRAM_TEXT_MAX_BYTES} UTF-8 bytes and this message is ${instagramTextByteLength(
            input.value.reply
          )}`,
        },
        { status: 400 }
      ),
      // En bytes: es un DM, no un comentario.
      { textLength: instagramTextByteLength(input.value.reply) }
    )
  }

  const target = await resolveCommentReplyTarget({
    tenantId,
    value: input.value,
  })
  if (!target.ok) return trace.drop(target.reason, target.response)
  const { page, pageAccessToken, sourceComment } = target.value
  trace.setAccount(page)

  // El límite de una sola respuesta privada por comentario, chequeado antes de
  // llamar. Meta también lo aplica, pero lo rechaza con un 100/2534025 que junta
  // cuatro causas distintas —vencida, ya contestada, borrada, o el usuario no
  // acepta mensajes— y el usuario no puede saber cuál fue. Acá lo sabemos con
  // certeza, así que el 409 lo dice.
  //
  // Notar que esto **no reemplaza** al `Idempotency-Key`: un reintento con la
  // misma clave devuelve el resultado original con `idempotentReplay`, mientras
  // que dos intentos deliberados de contestar el mismo comentario son un 409.
  const alreadyReplied = await getPrivateReplyForComment({
    tenantId,
    igCommentId: input.value.commentId,
  })
  if (alreadyReplied) {
    // No es un `duplicate`: un replay idempotente devuelve el resultado
    // original, y esto es un **segundo intento deliberado** de gastar la única
    // respuesta privada que Instagram permite. Son dos cosas distintas y por
    // eso son dos outcomes distintos.
    return trace.drop(
      "invalid_request",
      Response.json(
        {
          error:
            "this comment already received a private reply: Instagram allows exactly one per comment",
          resender: {
            conversationId: alreadyReplied.conversationId,
            messageId: alreadyReplied.id,
            status: alreadyReplied.status,
          },
        },
        { status: 409 }
      ),
      { subjectId: alreadyReplied.id }
    )
  }

  // El destinatario sale del comentario guardado y no del body: `from_ig_id` es
  // el IGSID de quien comentó, la misma identidad que `conversations.contact_id`
  // usa para los DMs. Que el cliente no lo elija es lo que impide usar el
  // comentario de una persona como excusa para escribirle a otra.
  const contactId = sourceComment.fromIgId

  const conversation = await upsertConversation({
    tenantId,
    connectedPageId: page.id,
    contactId,
    lastMessageAt: new Date(),
  })

  const sentAt = new Date()
  const metaResult = await sendInstagramPrivateReply({
    accessToken: pageAccessToken,
    igCommentId: input.value.commentId,
    text: input.value.reply,
  })

  if (!metaResult.ok && isMetaExpiredTokenError(metaResult.data)) {
    try {
      await markPageTokenInvalid({
        tenantId,
        connectionId: page.id,
        error:
          metaResult.error ??
          "Meta rejected the Instagram token. Reconnect the account in Resender.",
      })
    } catch (error) {
      log({
        entrypoint: "route",
        action: "token_invalidate",
        outcome: "failed",
        reason: "internal_error",
        requestId,
        tenantId,
        connectionId: page.id,
        channel: "instagram",
        accountId: page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  let message: MessageRecord
  try {
    message = await insertOutboundMessage({
      tenantId,
      conversationId: conversation.id,
      connectedPageId: page.id,
      contactId,
      text: input.value.reply,
      status: metaResult.ok ? "sent" : "failed",
      metaMessageId: extractMetaMessageId(metaResult.data),
      idempotencyKey,
      // Lo que convierte este DM en una respuesta privada auditable. Se guarda
      // también cuando Meta rechazó: el intento fallido no consumió la única
      // respuesta disponible —por eso `getPrivateReplyForComment` solo mira los
      // `sent`— pero sí queda en el log.
      instagramSourceCommentId: input.value.commentId,
      error: metaResult.reason ?? metaResult.error,
      providerResponse: metaResult.data,
      createdAt: sentAt,
    })
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await getOutboundMessageByIdempotencyKey(
        tenantId,
        idempotencyKey
      )
      if (existing) {
        return trace.duplicate(idempotentReplayResponse(existing), {
          subjectId: existing.id,
        })
      }
    }
    trace.failed("internal_error", { errorMessage: describeError(error) })
    throw error
  }

  // Solo consume cuota la respuesta que Meta aceptó (ADR 0011): el cliente no
  // paga por los siete días vencidos ni por un token nuestro. Los replays
  // idempotentes ya devolvieron antes de llegar acá, así que tampoco suman.
  // Best-effort: un fallo del contador no puede hacer fallar un DM que Meta ya
  // entregó.
  if (metaResult.ok) {
    try {
      await incrementUsage(tenantId, periodStart)
    } catch (error) {
      log({
        entrypoint: "route",
        action: "usage_increment",
        outcome: "failed",
        reason: "usage_counter_failed",
        requestId,
        tenantId,
        channel: "instagram",
        accountId: page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  // Una línea terminal por request. El rechazo más frecuente acá es el
  // `100/2534025`, que junta cuatro causas —pasaron 7 días, ya contestamos, lo
  // borraron, o esa persona no acepta mensajes— y Meta no dice cuál. El código
  // queda en el log para poder contarlas.
  const traceFields = {
    subjectId: message.id,
    providerId: input.value.commentId,
    contactId: sourceComment.fromIgId,
    textLength: instagramTextByteLength(input.value.reply),
    status: metaResult.status,
    durationMs: Date.now() - sentAt.getTime(),
  }
  if (metaResult.ok) {
    trace.ok(traceFields)
  } else {
    trace.failed("meta_rejected", {
      ...traceFields,
      errorMessage: metaResult.reason ?? metaResult.error ?? undefined,
    })
  }

  if (posthog) {
    posthog.capture({
      distinctId: tenantId,
      event: "instagram private reply sent",
      properties: {
        message_id: message.id,
        conversation_id: conversation.id,
        ig_comment_id: input.value.commentId,
        page_id: page.metaPageId,
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
