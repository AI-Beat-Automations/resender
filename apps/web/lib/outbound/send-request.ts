export const OUTBOUND_ATTACHMENT_TYPES = [
  "image",
  "video",
  "audio",
  "file",
] as const
export type OutboundAttachmentType = (typeof OUTBOUND_ATTACHMENT_TYPES)[number]

export type OutboundAttachment = { type: OutboundAttachmentType; url: string }

export type OutboundSendErrorCode =
  | "send_target_missing"
  | "send_target_conflict"
  | "attachment_type_invalid"
  | "attachment_url_missing"
  | "attachment_url_invalid"

// Un envío lleva exactamente una de las dos cosas: texto o adjunto. La unión
// discriminada obliga al que consume el valor a contemplar ambos casos en vez
// de asumir que `reply` siempre existe.
export type OutboundSendInput = {
  pageId: string
  recipientId: string
  conversationId?: string
} & (
  | { reply: string; attachment: null }
  | { reply: null; attachment: OutboundAttachment }
)

export type OutboundSendInputResult =
  | { ok: true; value: OutboundSendInput }
  | { ok: false; code: OutboundSendErrorCode | null; error: string }

// El tope es 4096 y no 2048 a propósito: una URL firmada de S3/GCS ronda
// 1–1.5 KB y con una query larga se pasa de 2048 sin ser inválida.
const ATTACHMENT_URL_MAX_LENGTH = 4096

function isOutboundAttachmentType(
  value: unknown
): value is OutboundAttachmentType {
  return OUTBOUND_ATTACHMENT_TYPES.includes(value as OutboundAttachmentType)
}

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
    return { ok: false, code: null, error: "invalid body" }
  }

  const { pageId, recipientId, reply, attachment, conversationId } =
    body as Record<string, unknown>

  // Errores viejos, sin código estable: los clientes existentes ya dependen
  // del texto y no hace falta que la API los distinga por código.
  if (typeof pageId !== "string" || pageId.trim().length === 0) {
    return { ok: false, code: null, error: "missing pageId" }
  }
  if (typeof recipientId !== "string" || recipientId.trim().length === 0) {
    return { ok: false, code: null, error: "missing recipientId" }
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || conversationId.trim().length === 0)
  ) {
    return { ok: false, code: null, error: "invalid conversationId" }
  }

  // XOR texto/adjunto. "reply presente" exige contenido tras trim (igual que
  // siempre); "attachment presente" es que la clave venga con algo distinto de
  // undefined/null, para que `attachment: null` explícito siga siendo un envío
  // de texto normal.
  const hasReply = typeof reply === "string" && reply.trim().length > 0
  const hasAttachment = attachment !== undefined && attachment !== null

  if (!hasReply && !hasAttachment) {
    return {
      ok: false,
      code: "send_target_missing",
      error: "send exactly one of reply or attachment",
    }
  }
  if (hasReply && hasAttachment) {
    return {
      ok: false,
      code: "send_target_conflict",
      error: "reply and attachment are mutually exclusive; send exactly one of them",
    }
  }

  if (hasReply) {
    return {
      ok: true,
      value: {
        pageId: pageId.trim(),
        recipientId: recipientId.trim(),
        reply: reply.trim(),
        attachment: null,
        conversationId: conversationId?.trim(),
      },
    }
  }

  if (typeof attachment !== "object" || Array.isArray(attachment)) {
    return {
      ok: false,
      code: "attachment_type_invalid",
      error: "attachment.type must be one of image, video, audio, file",
    }
  }

  const { type, url } = attachment as Record<string, unknown>

  if (!isOutboundAttachmentType(type)) {
    return {
      ok: false,
      code: "attachment_type_invalid",
      error: "attachment.type must be one of image, video, audio, file",
    }
  }

  if (typeof url !== "string" || url.trim().length === 0) {
    return {
      ok: false,
      code: "attachment_url_missing",
      error: "missing attachment.url",
    }
  }

  // Meta descarga el adjunto desde esta URL, así que tiene que ser https
  // público: sin `http:` plano y sin credenciales embebidas (`user:pass@`),
  // que Graph no va a usar y solo servirían para filtrar secretos en logs.
  const trimmedUrl = url.trim()
  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedUrl)
  } catch {
    return {
      ok: false,
      code: "attachment_url_invalid",
      error: "attachment.url must be a valid https URL",
    }
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    trimmedUrl.length > ATTACHMENT_URL_MAX_LENGTH
  ) {
    return {
      ok: false,
      code: "attachment_url_invalid",
      error:
        "attachment.url must be an https URL without credentials, at most 4096 characters long",
    }
  }

  return {
    ok: true,
    value: {
      pageId: pageId.trim(),
      recipientId: recipientId.trim(),
      reply: null,
      attachment: { type, url: trimmedUrl },
      conversationId: conversationId?.trim(),
    },
  }
}
