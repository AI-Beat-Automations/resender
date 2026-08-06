import { type NextRequest } from "next/server"

import {
  insertOutboundComment,
  getOutboundCommentByIdempotencyKey,
  type InstagramCommentRecord,
} from "@/lib/comments/comment-log"
import {
  authenticateCommentReplyRequest,
  isUniqueViolation,
  resolveCommentReplyTarget,
} from "@/lib/outbound/comment-reply-request"
import {
  exceedsInstagramCommentLimit,
  extractPublishedCommentId,
  instagramCommentLength,
  INSTAGRAM_COMMENT_MAX_CHARS,
  replyToInstagramComment,
} from "@/lib/outbound/instagram-comment-reply"
import { isMetaExpiredTokenError } from "@/lib/outbound/instagram-send"
import { parseCommentReplyInput } from "@/lib/outbound/send-request"
import { markPageTokenInvalid } from "@/lib/pages/page-registry"
import { posthog } from "@/lib/posthog"

// Publica una **respuesta pública** debajo del comentario, visible para
// cualquiera que mire la publicación.
// Body: { pageId, commentId, reply }.
// Header opcional `Idempotency-Key`: si se repite, se devuelve el resultado
// almacenado sin volver a publicar.
//
// La idempotencia importa más acá que en un DM: un reintento sin ella publica
// un segundo comentario visible que hay que ir a borrar a mano, porque
// Instagram no pone ningún límite de una respuesta por comentario en este
// endpoint —ese límite es de la respuesta privada, que va por la otra ruta—.
//
// El token de la cuenta se resuelve en el servidor por `pageId` y nunca viaja
// en la request, igual que en el resto de los endpoints salientes.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const auth = await authenticateCommentReplyRequest(request)
  if (!auth.ok) return auth.response
  const { tenantId, idempotencyKey } = auth.value

  // El replay se resuelve antes que nada: no llama a Meta ni inserta, así que
  // devolver el resultado ya almacenado es lo único correcto.
  if (idempotencyKey) {
    const replay = await getOutboundCommentByIdempotencyKey(
      tenantId,
      idempotencyKey
    )
    if (replay) return idempotentReplayResponse(replay)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }

  const input = parseCommentReplyInput(body)
  if (!input.ok) {
    return Response.json({ error: input.error }, { status: 400 })
  }

  // Un comentario se mide en caracteres, no en bytes como el DM: son dos
  // superficies de Instagram con dos límites distintos.
  if (exceedsInstagramCommentLimit(input.value.reply)) {
    return Response.json(
      {
        error: `reply is too long: an Instagram comment allows ${INSTAGRAM_COMMENT_MAX_CHARS} characters and this reply is ${instagramCommentLength(
          input.value.reply
        )}`,
      },
      { status: 400 }
    )
  }

  const target = await resolveCommentReplyTarget({
    tenantId,
    value: input.value,
  })
  if (!target.ok) return target.response
  const { page, pageAccessToken, sourceComment } = target.value

  const sentAt = new Date()
  const metaResult = await replyToInstagramComment({
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
      console.error(
        "failed to mark instagram token invalid",
        page.metaPageId,
        error
      )
    }
  }

  let comment: InstagramCommentRecord
  try {
    // Se persiste tanto si Meta la aceptó como si la rechazó, igual que un DM
    // saliente: el rechazo es justamente lo que el usuario necesita ver en el
    // log. Si falló no hay `ig_comment_id` porque no se publicó nada, y la
    // columna es nullable precisamente para eso (migración 0013).
    comment = await insertOutboundComment({
      tenantId,
      connectedPageId: page.id,
      igCommentId: extractPublishedCommentId(metaResult.data),
      parentIgCommentId: input.value.commentId,
      mediaId: sourceComment.mediaId,
      mediaProductType: sourceComment.mediaProductType,
      // Quien comenta es la propia cuenta: la respuesta sale de ella. `from_ig_id`
      // guarda su IG ID y no el del comentador, que es lo que hace que la fila se
      // lea igual que el comentario que va a llegar por el webhook.
      fromIgId: page.metaPageId,
      fromUsername: page.username,
      status: metaResult.ok ? "sent" : "failed",
      text: input.value.reply,
      idempotencyKey,
      error: metaResult.reason ?? metaResult.error,
      providerResponse: metaResult.data,
      createdAt: sentAt,
    })
  } catch (error) {
    // Carrera de dos requests con la misma Idempotency-Key: el índice único
    // parcial rechaza el segundo insert y devolvemos el resultado almacenado.
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await getOutboundCommentByIdempotencyKey(
        tenantId,
        idempotencyKey
      )
      if (existing) return idempotentReplayResponse(existing)
    }
    throw error
  }

  // Sin `incrementUsage`: Instagram no consume cuota.

  if (posthog) {
    posthog.capture({
      distinctId: tenantId,
      event: "instagram comment replied",
      properties: {
        instagram_comment_id: comment.id,
        parent_ig_comment_id: input.value.commentId,
        media_id: sourceComment.mediaId,
        page_id: page.metaPageId,
        status: comment.status,
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
        commentId: comment.id,
        igCommentId: comment.igCommentId,
        status: comment.status,
      },
    },
    { status: metaResult.status }
  )
}

function idempotentReplayResponse(comment: InstagramCommentRecord) {
  return Response.json({
    ...(comment.status === "failed" && comment.error
      ? { error: comment.error }
      : {}),
    resender: {
      commentId: comment.id,
      igCommentId: comment.igCommentId,
      status: comment.status,
      idempotentReplay: true,
    },
  })
}
