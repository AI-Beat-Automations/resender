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
        attachment: null,
        conversationId: "conversation",
      },
    })
    // Los errores viejos no tienen código estable: viajan con `code: null`.
    expect(parseOutboundSendInput({ pageId: "page" })).toEqual({
      ok: false,
      code: null,
      error: "missing recipientId",
    })
  })

  it("rejects a body with neither reply nor attachment", () => {
    expect(
      parseOutboundSendInput({ pageId: "page", recipientId: "psid" })
    ).toMatchObject({ ok: false, code: "send_target_missing" })
    // `attachment: null` explícito cuenta como ausente, no como conflicto.
    expect(
      parseOutboundSendInput({
        pageId: "page",
        recipientId: "psid",
        reply: "hola",
        attachment: null,
      })
    ).toMatchObject({ ok: true })
  })

  it("rejects a body with both reply and attachment", () => {
    expect(
      parseOutboundSendInput({
        pageId: "page",
        recipientId: "psid",
        reply: "hola",
        attachment: { type: "image", url: "https://cdn.example.com/a.jpg" },
      })
    ).toMatchObject({ ok: false, code: "send_target_conflict" })
  })

  it("rejects unknown attachment types naming the valid ones", () => {
    expect(
      parseOutboundSendInput({
        pageId: "page",
        recipientId: "psid",
        attachment: { type: "gif", url: "https://cdn.example.com/a.gif" },
      })
    ).toEqual({
      ok: false,
      code: "attachment_type_invalid",
      error: "attachment.type must be one of image, video, audio, file",
    })
    // Un adjunto que ni siquiera es objeto cae en el mismo código.
    expect(
      parseOutboundSendInput({
        pageId: "page",
        recipientId: "psid",
        attachment: "https://cdn.example.com/a.jpg",
      })
    ).toMatchObject({ ok: false, code: "attachment_type_invalid" })
  })

  it("rejects attachments without a url", () => {
    expect(
      parseOutboundSendInput({
        pageId: "page",
        recipientId: "psid",
        attachment: { type: "image" },
      })
    ).toMatchObject({ ok: false, code: "attachment_url_missing" })
    expect(
      parseOutboundSendInput({
        pageId: "page",
        recipientId: "psid",
        attachment: { type: "image", url: "   " },
      })
    ).toMatchObject({ ok: false, code: "attachment_url_missing" })
  })

  it("rejects http, credentialed, and oversized attachment urls", () => {
    const base = { pageId: "page", recipientId: "psid" }

    expect(
      parseOutboundSendInput({
        ...base,
        attachment: { type: "image", url: "http://cdn.example.com/a.jpg" },
      })
    ).toMatchObject({ ok: false, code: "attachment_url_invalid" })

    expect(
      parseOutboundSendInput({
        ...base,
        attachment: {
          type: "image",
          url: "https://user:pass@cdn.example.com/a.jpg",
        },
      })
    ).toMatchObject({ ok: false, code: "attachment_url_invalid" })

    const oversized = `https://cdn.example.com/a.jpg?pad=${"a".repeat(4096)}`
    expect(
      parseOutboundSendInput({
        ...base,
        attachment: { type: "image", url: oversized },
      })
    ).toMatchObject({ ok: false, code: "attachment_url_invalid" })
  })

  // Una URL firmada de S3/GCS ronda 1–1.5 KB; el tope de 4096 existe para que
  // pasen sin drama incluso las más largas.
  it("accepts a ~3KB signed https url", () => {
    const signed = `https://bucket.s3.amazonaws.com/uploads/a.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20260818%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=${"f".repeat(2900)}`
    expect(signed.length).toBeGreaterThan(2900)
    expect(signed.length).toBeLessThanOrEqual(4096)

    expect(
      parseOutboundSendInput({
        pageId: "page",
        recipientId: "psid",
        attachment: { type: "file", url: ` ${signed} ` },
      })
    ).toEqual({
      ok: true,
      value: {
        pageId: "page",
        recipientId: "psid",
        reply: null,
        attachment: { type: "file", url: signed },
        conversationId: undefined,
      },
    })
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
