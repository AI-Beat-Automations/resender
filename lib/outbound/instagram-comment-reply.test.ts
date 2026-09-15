import { afterEach, describe, expect, it, vi } from "vitest"

import {
  exceedsInstagramCommentLimit,
  explainInstagramCommentError,
  explainInstagramPrivateReplyError,
  extractPublishedCommentId,
  instagramCommentLength,
  INSTAGRAM_COMMENT_MAX_CHARS,
  replyToInstagramComment,
  sendInstagramPrivateReply,
} from "./instagram-comment-reply"
import {
  exceedsInstagramTextLimit,
  explainInstagramError,
} from "./instagram-send"

const graphError = (code: number, subcode?: number) => ({
  error: {
    message: "algo salió mal",
    type: "OAuthException",
    code,
    ...(subcode === undefined ? {} : { error_subcode: subcode }),
  },
})

describe("límite de un comentario de Instagram", () => {
  it("cuenta 2200 caracteres, no los 1000 bytes del DM", () => {
    const text = "a".repeat(2000)

    expect(exceedsInstagramCommentLimit(text)).toBe(false)
    // El mismo texto no entra en un DM: son dos superficies con dos límites.
    expect(exceedsInstagramTextLimit(text)).toBe(true)
  })

  it("deja pasar un comentario justo en el límite", () => {
    expect(exceedsInstagramCommentLimit("a".repeat(2200))).toBe(false)
    expect(exceedsInstagramCommentLimit("a".repeat(2201))).toBe(true)
  })

  // `text.length` cuenta unidades UTF-16, y un emoji fuera del plano básico son
  // dos. Contar así rechazaría un comentario que Instagram acepta.
  it("cuenta code points y no unidades UTF-16", () => {
    const text = "🙂".repeat(INSTAGRAM_COMMENT_MAX_CHARS)

    expect(text.length).toBe(INSTAGRAM_COMMENT_MAX_CHARS * 2)
    expect(instagramCommentLength(text)).toBe(INSTAGRAM_COMMENT_MAX_CHARS)
    expect(exceedsInstagramCommentLimit(text)).toBe(false)
  })
})

describe("catálogo de la respuesta pública", () => {
  // Una respuesta pública no tiene ventana de ningún tipo, así que un 10 acá
  // solo puede ser el permiso. Con el catálogo de los DMs, el mismo código
  // habría hablado de `instagram_business_manage_messages`, que no es el
  // permiso que falta.
  it("atribuye el 10 al permiso de comentarios y no al de mensajes", () => {
    const reason = explainInstagramCommentError(graphError(10))

    expect(reason).toContain("instagram_business_manage_comments")
    expect(explainInstagramError(graphError(10))).toContain(
      "instagram_business_manage_messages"
    )
  })

  // El 10 con el subcode de la ventana de 24 horas no puede llegar acá, y si
  // llegara, nombrar una ventana que este endpoint no tiene mandaría al usuario
  // a esperar algo que nunca va a cambiar.
  it("no habla de ventanas en ningún caso", () => {
    expect(explainInstagramCommentError(graphError(10, 2534022))).not.toContain(
      "window"
    )
  })

  // En los DMs el 100 es un IGSID mal formado; en un comentario es un id que ya
  // no se puede contestar. Mismo código, dos cosas que hacer distintas.
  it("lee el 100 como un comentario que ya no se puede contestar", () => {
    const reason = explainInstagramCommentError(graphError(100))

    expect(reason).toContain("deleted or hidden")
    expect(reason).toContain("live video")
  })

  it("comparte con los DMs el token, el rate limit y el bloqueo", () => {
    expect(explainInstagramCommentError(graphError(190))).toBe(
      explainInstagramError(graphError(190))
    )
    expect(explainInstagramCommentError(graphError(613))).toBe(
      explainInstagramError(graphError(613))
    )
    expect(explainInstagramCommentError(graphError(368))).toBe(
      explainInstagramError(graphError(368))
    )
  })

  it("devuelve null ante un error que no está en el catálogo", () => {
    expect(explainInstagramCommentError(graphError(999999))).toBeNull()
    expect(explainInstagramCommentError(null)).toBeNull()
  })
})

describe("catálogo de la respuesta privada", () => {
  // El rechazo más frecuente de este endpoint. Meta junta cuatro causas bajo un
  // mismo código y no dice cuál fue, así que el mensaje las enumera en vez de
  // afirmar una sola.
  it("enumera las cuatro causas del 100/2534025 sin elegir una", () => {
    const reason = explainInstagramPrivateReplyError(graphError(100, 2534025))!

    expect(reason).toContain("7 days")
    expect(reason).toContain("one per comment")
    expect(reason).toContain("still exist")
    expect(reason).toContain("message requests")
  })

  // El mismo 100 sin subcode es el catálogo de comentarios, no este: sin el
  // subcode no hay nada que permita afirmar que el comentario no es elegible.
  it("no aplica el diagnóstico de elegibilidad a un 100 sin subcode", () => {
    expect(explainInstagramPrivateReplyError(graphError(100))).toBeNull()
  })

  it("nombra el límite de una sola respuesta privada en el 10900", () => {
    expect(explainInstagramPrivateReplyError(graphError(10900))).toContain(
      "exactly one per comment"
    )
  })

  it("distingue los DMs deshabilitados por el dueño de la cuenta", () => {
    expect(
      explainInstagramPrivateReplyError(graphError(200, 2534041))
    ).toContain("disabled access to direct messages")
  })

  // El permiso de una respuesta privada es el de comentarios, no el de
  // mensajes, aunque lo que salga sea un DM.
  it("pide el permiso de comentarios y no el de mensajes", () => {
    expect(explainInstagramPrivateReplyError(graphError(10))).toContain(
      "instagram_business_manage_comments"
    )
  })
})

describe("publicación de una respuesta pública", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("pega a /<ig-comment-id>/replies con el token en el header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "ig-reply-1" }), { status: 200 })
      )

    const result = await replyToInstagramComment({
      accessToken: "ig-token",
      igCommentId: "ig-comment-1",
      text: "gracias!",
    })

    expect(result.ok).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]!
    // El id del comentario va en el path: el token dice quién responde y el
    // path a qué. Es la diferencia con el DM, que no lleva id.
    expect(url).toBe("https://graph.instagram.com/v23.0/ig-comment-1/replies")
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer ig-token"
    )
    // Ni el token ni el texto del usuario pueden terminar en la query string,
    // donde quedarían en cualquier log de URLs.
    expect(String(url)).not.toContain("ig-token")
    expect(String(url)).not.toContain("gracias")
    expect(String(init?.body)).toBe("message=gracias%21")
  })

  it("devuelve el id publicado, que viene como `id` y no como `message_id`", () => {
    expect(extractPublishedCommentId({ id: "ig-reply-1" })).toBe("ig-reply-1")
    expect(extractPublishedCommentId({ message_id: "mid-1" })).toBeNull()
    expect(extractPublishedCommentId(null)).toBeNull()
  })

  it("traduce el rechazo de Meta al motivo del catálogo de comentarios", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(graphError(100)), { status: 400 })
    )

    const result = await replyToInstagramComment({
      accessToken: "ig-token",
      igCommentId: "ig-comment-1",
      text: "gracias!",
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe("algo salió mal")
    expect(result.reason).toContain("deleted or hidden")
  })

  it("convierte un fallo de red en un 502 con motivo accionable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"))

    const result = await replyToInstagramComment({
      accessToken: "ig-token",
      igCommentId: "ig-comment-1",
      text: "gracias!",
    })

    expect(result).toMatchObject({ ok: false, status: 502, error: "timeout" })
    expect(result.reason).toContain("Retry shortly")
  })
})

describe("envío de una respuesta privada", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Lo que distingue una respuesta privada de un DM normal es exactamente esto:
  // el `recipient` lleva `comment_id` en vez de `id`. Es lo que le dice a Meta
  // que el envío se ampara en el comentario y no en la ventana de 24 horas.
  it("manda recipient.comment_id y no recipient.id", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message_id: "mid-1" }), { status: 200 })
      )

    const result = await sendInstagramPrivateReply({
      accessToken: "ig-token",
      igCommentId: "ig-comment-1",
      text: "te escribo por privado",
    })

    expect(result.ok).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://graph.instagram.com/v23.0/me/messages")

    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      recipient: { comment_id: "ig-comment-1" },
      message: { text: "te escribo por privado" },
    })
    expect(body.recipient).not.toHaveProperty("id")
    expect(body).not.toHaveProperty("messaging_type")
  })

  it("traduce el rechazo con el catálogo de respuestas privadas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(graphError(100, 2534025)), { status: 400 })
    )

    const result = await sendInstagramPrivateReply({
      accessToken: "ig-token",
      igCommentId: "ig-comment-1",
      text: "hola",
    })

    expect(result.reason).toContain("7 days")
    // El catálogo de los DMs no sabe nada de este caso.
    expect(explainInstagramError(graphError(100, 2534025))).not.toContain(
      "7 days"
    )
  })
})
