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
