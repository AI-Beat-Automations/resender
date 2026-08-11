import { describe, expect, it } from "vitest"

import {
  getBearerToken,
  parseCommentReplyInput,
  parseOutboundSendInput,
} from "./send-request"

describe("outbound send request", () => {
  it("extracts bearer tokens", () => {
    expect(getBearerToken("Bearer pk_live_abc")).toBe("pk_live_abc")
    expect(getBearerToken("bearer   pk_live_abc")).toBe("pk_live_abc")
    expect(getBearerToken("Basic abc")).toBeNull()
    expect(getBearerToken("Bearer pk_live_abc extra")).toBeNull()
    expect(getBearerToken(null)).toBeNull()
  })

  it("validates and trims the send payload", () => {
    expect(
      parseOutboundSendInput({
        pageId: " page ",
        recipientId: " psid ",
        reply: " hola ",
        conversationId: " conversation ",
      })
    ).toEqual({
      ok: true,
      value: {
        pageId: "page",
        recipientId: "psid",
        reply: "hola",
        conversationId: "conversation",
      },
    })
    expect(parseOutboundSendInput({ pageId: "page" }).ok).toBe(false)
  })

  it("validates and trims the comment reply payload", () => {
    expect(
      parseCommentReplyInput({
        pageId: " ig-account ",
        commentId: " ig-comment ",
        reply: " gracias ",
      })
    ).toEqual({
      ok: true,
      value: {
        pageId: "ig-account",
        commentId: "ig-comment",
        reply: "gracias",
      },
    })
    expect(parseCommentReplyInput({ pageId: "p", reply: "r" })).toEqual({
      ok: false,
      error: "missing commentId",
    })
  })

  // No hay `recipientId`: en la respuesta pública el destino es el comentario y
  // en la privada el IGSID sale del comentario guardado. Aceptarlo abriría la
  // puerta a escribirle a alguien distinto del que comentó, amparado en un
  // comentario ajeno.
  it("ignores a recipientId smuggled into a comment reply", () => {
    const parsed = parseCommentReplyInput({
      pageId: "ig-account",
      commentId: "ig-comment",
      reply: "gracias",
      recipientId: "otro-igsid",
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value).not.toHaveProperty("recipientId")
  })
})
