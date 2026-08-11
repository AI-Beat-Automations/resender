export type OutboundSendInput = {
  pageId: string
  recipientId: string
  reply: string
  conversationId?: string
}

export type OutboundSendInputResult =
  | { ok: true; value: OutboundSendInput }
  | { ok: false; error: string }

export function getBearerToken(authorization: string | null) {
  if (!authorization) return null
  const [scheme, token, extra] = authorization.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null
  return token
}

export type CommentReplyInput = {
  pageId: string
  commentId: string
  reply: string
}

export type CommentReplyInputResult =
  | { ok: true; value: CommentReplyInput }
  | { ok: false; error: string }

// Body de las dos rutas de respuesta a comentarios. `commentId` es el id de
// **Meta** (`comment.igCommentId` del push) y no el uuid de Resender: es el que
// el tenant siempre tiene —le llegó en el webhook y también lo ve en Instagram—
// y el único que sirve para llamar a Graph. El uuid interno se resuelve del
// lado del servidor.
//
// No hay `recipientId`: en la respuesta pública el destino es el comentario, y
// en la privada el IGSID sale del comentario guardado. Pedírselo al cliente
// abriría la puerta a mandarle un DM a alguien distinto del que comentó,
// amparado en un comentario que no es suyo.
export function parseCommentReplyInput(body: unknown): CommentReplyInputResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid body" }
  }

  const { pageId, commentId, reply } = body as Record<string, unknown>

  if (typeof pageId !== "string" || pageId.trim().length === 0) {
    return { ok: false, error: "missing pageId" }
  }
  if (typeof commentId !== "string" || commentId.trim().length === 0) {
    return { ok: false, error: "missing commentId" }
  }
  if (typeof reply !== "string" || reply.trim().length === 0) {
    return { ok: false, error: "missing reply" }
  }

  return {
    ok: true,
    value: {
      pageId: pageId.trim(),
      commentId: commentId.trim(),
      reply: reply.trim(),
    },
  }
}

export function parseOutboundSendInput(body: unknown): OutboundSendInputResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid body" }
  }

  const { pageId, recipientId, reply, conversationId } = body as Record<
    string,
    unknown
  >

  if (typeof pageId !== "string" || pageId.trim().length === 0) {
    return { ok: false, error: "missing pageId" }
  }
  if (typeof recipientId !== "string" || recipientId.trim().length === 0) {
    return { ok: false, error: "missing recipientId" }
  }
  if (typeof reply !== "string" || reply.trim().length === 0) {
    return { ok: false, error: "missing reply" }
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || conversationId.trim().length === 0)
  ) {
    return { ok: false, error: "invalid conversationId" }
  }

  return {
    ok: true,
    value: {
      pageId: pageId.trim(),
      recipientId: recipientId.trim(),
      reply: reply.trim(),
      conversationId: conversationId?.trim(),
    },
  }
}
