import { describe, expect, it, vi } from "vitest"

import {
  explainCommentError,
  explainMessageError,
  explainPrivateReplyError,
  InstagramClient,
  instagramCommentLength,
  instagramTextByteLength,
  INSTAGRAM_COMMENT_MAX_CHARS,
  INSTAGRAM_TEXT_MAX_BYTES,
} from "./instagram-client"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const graphError = (code: number, subcode?: number) => ({
  error: {
    message: "algo salió mal",
    code,
    ...(subcode === undefined ? {} : { error_subcode: subcode }),
  },
})

function client(fetcher: typeof fetch) {
  return new InstagramClient("app-id", "app-secret", fetcher)
}

describe("Instagram text limits", () => {
  // Instagram cuenta bytes UTF-8 en un DM: cada acento son 2 y cada emoji 4.
  it("counts UTF-8 bytes for direct messages", () => {
    const text = "ñ".repeat(501)

    expect(text.length).toBeLessThan(INSTAGRAM_TEXT_MAX_BYTES)
    expect(instagramTextByteLength(text)).toBeGreaterThan(
      INSTAGRAM_TEXT_MAX_BYTES
    )
  })

  // Un comentario se mide en caracteres y no en bytes: dos superficies, dos
  // límites, dos unidades. Y por code points, no por unidades UTF-16.
  it("counts code points for comments", () => {
    const text = "🙂".repeat(INSTAGRAM_COMMENT_MAX_CHARS)

    expect(text.length).toBe(INSTAGRAM_COMMENT_MAX_CHARS * 2)
    expect(instagramCommentLength(text)).toBe(INSTAGRAM_COMMENT_MAX_CHARS)
  })
})

describe("Instagram Login OAuth", () => {
  // El `code` llega con `#_` pegado al final y ese sufijo no es parte del
  // código: sin quitarlo el intercambio falla con un error que no nombra la
  // causa.
  it("strips the #_ suffix Instagram appends to the code", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "short" }))
      .mockResolvedValueOnce(
        json({ access_token: "long", expires_in: 5_184_000 })
      )

    const token = await client(
      fetcher as unknown as typeof fetch
    ).exchangeAuthorizationCode({
      code: "AQB123#_",
      redirectUri: "https://app.example/callback",
    })

    expect(token.accessToken).toBe("long")
    expect(token.expiresAt).toBeInstanceOf(Date)
    const body = String((fetcher.mock.calls[0]![1] as RequestInit).body)
    expect(body).toContain("code=AQB123")
    expect(body).not.toContain("%23_")
  })

  // Las respuestas vienen envueltas en `{"data":[{…}]}` y no planas como en la
  // documentación vieja. Atarse a una forma la rompe en silencio.
  it("reads both the flat and the {data:[…]} response shapes", async () => {
    const wrapped = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ access_token: "short" }] }))
      .mockResolvedValueOnce(json({ data: [{ access_token: "long" }] }))

    await expect(
      client(wrapped as unknown as typeof fetch).exchangeAuthorizationCode({
        code: "AQB123",
        redirectUri: "https://app.example/callback",
      })
    ).resolves.toMatchObject({ accessToken: "long" })
  })

  // `user_id` ≠ `id`. El `id` es app-scoped; el que llega como `entry.id` en el
  // webhook es `user_id`, y guardar el equivocado deja la cuenta conectada y
  // muda, con un síntoma que no señala la causa.
  it("takes the professional account id from user_id, not id", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      json({
        id: "app-scoped-id",
        user_id: "17841400000000000",
        username: "cuenta",
        name: "Cuenta",
      })
    )

    const profile = await client(fetcher as unknown as typeof fetch).getProfile(
      "token"
    )

    expect(profile.providerAccountId).toBe("17841400000000000")
    expect(String(fetcher.mock.calls[0]![0])).toContain("fields=user_id")
  })

  it("falls back to the handle when Instagram omits the display name", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ user_id: "17841400000000000", username: "cuenta" })
      )

    await expect(
      client(fetcher as unknown as typeof fetch).getProfile("token")
    ).resolves.toMatchObject({ name: "cuenta" })
  })
})

describe("Instagram sends", () => {
  it("posts a DM to /me/messages with the token in the header", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ message_id: "mid-1" }))

    const result = await client(fetcher as unknown as typeof fetch).sendText({
      accessToken: "ig-token",
      recipientId: "igsid-1",
      text: "hola",
    })

    expect(result).toMatchObject({ ok: true, messageId: "mid-1" })
    const [url, init] = fetcher.mock.calls[0]!
    // Sin id en el path: el token identifica a la cuenta que envía.
    expect(url).toBe("https://graph.instagram.com/v23.0/me/messages")
    expect(String(url)).not.toContain("ig-token")
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toEqual({
      recipient: { id: "igsid-1" },
      message: { text: "hola" },
    })
    // `messaging_type` es de la Send API de Messenger; mandarlo es pedir un
    // rechazo.
    expect(body).not.toHaveProperty("messaging_type")
  })

  // Lo que distingue una respuesta privada de un DM normal: `comment_id` en vez
  // de `id` es lo que le dice a Meta que el envío se ampara en el comentario y
  // no en la ventana de 24 horas.
  it("sends a private reply addressed to the comment, not to the IGSID", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ message_id: "mid-1" }))

    await client(fetcher as unknown as typeof fetch).sendPrivateReply({
      accessToken: "ig-token",
      providerCommentId: "ig-comment-1",
      text: "hola",
    })

    const body = JSON.parse(
      String((fetcher.mock.calls[0]![1] as RequestInit).body)
    )
    expect(body.recipient).toEqual({ comment_id: "ig-comment-1" })
    expect(body.recipient).not.toHaveProperty("id")
  })

  it("publishes a public reply with the comment id in the path and the text in the body", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ id: "ig-reply-1" }))

    const result = await client(
      fetcher as unknown as typeof fetch
    ).replyToComment({
      accessToken: "ig-token",
      providerCommentId: "ig-comment-1",
      text: "gracias!",
    })

    expect(result).toMatchObject({ ok: true, commentId: "ig-reply-1" })
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe("https://graph.instagram.com/v23.0/ig-comment-1/replies")
    // Ni el token ni el texto del usuario pueden terminar en la query string.
    expect(String(url)).not.toContain("gracias")
    expect(String((init as RequestInit).body)).toBe("message=gracias%21")
  })

  it("classifies a 190 as an invalid token so the account can be flagged", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(graphError(190), 401))

    await expect(
      client(fetcher as unknown as typeof fetch).sendText({
        accessToken: "ig-token",
        recipientId: "igsid-1",
        text: "hola",
      })
    ).resolves.toMatchObject({ ok: false, kind: "invalid_token" })
  })

  it("treats 5xx and 429 as transient and other 4xx as rejections", async () => {
    const transient = vi.fn().mockResolvedValueOnce(json(graphError(1), 503))
    await expect(
      client(transient as unknown as typeof fetch).sendText({
        accessToken: "t",
        recipientId: "r",
        text: "t",
      })
    ).resolves.toMatchObject({ kind: "unavailable" })

    const rejected = vi.fn().mockResolvedValueOnce(json(graphError(100), 400))
    await expect(
      client(rejected as unknown as typeof fetch).sendText({
        accessToken: "t",
        recipientId: "r",
        text: "t",
      })
    ).resolves.toMatchObject({ kind: "rejected" })
  })
})

describe("the three error catalogues", () => {
  // El caso más frecuente de Instagram, y el que justifica no compartir el
  // catálogo con Messenger: el subcode de la ventana es otro (2018278 allá).
  it("names the 24-hour window with the Instagram subcode", () => {
    expect(explainMessageError(graphError(10, 2534022))).toContain(
      "24-hour window"
    )
  })

  // Una respuesta pública no tiene ventana de ningún tipo, así que un 10 acá
  // solo puede ser el permiso, y es **otro** permiso.
  it("reads a 10 on a public reply as the comments permission", () => {
    expect(explainCommentError(graphError(10))).toContain(
      "instagram_business_manage_comments"
    )
    expect(explainMessageError(graphError(10))).toContain(
      "instagram_business_manage_messages"
    )
    expect(explainCommentError(graphError(10, 2534022))).not.toContain("window")
  })

  // Mismo código, dos cosas distintas que hacer: en un DM es un IGSID mal
  // formado, en una respuesta es un comentario que ya no se puede contestar.
  it("reads a 100 differently for a DM and for a comment", () => {
    expect(explainCommentError(graphError(100))).toContain("deleted or hidden")
    expect(explainMessageError(graphError(100))).toContain("IGSID")
  })

  // Meta junta cuatro causas bajo el mismo código y no dice cuál fue, así que el
  // mensaje las enumera en vez de mandar al usuario a arreglar algo que está
  // bien.
  it("enumerates the four causes behind 100/2534025 instead of picking one", () => {
    const reason = explainPrivateReplyError(graphError(100, 2534025))!

    expect(reason).toContain("7 days")
    expect(reason).toContain("one per comment")
    expect(reason).toContain("still exist")
    expect(reason).toContain("message requests")
    // Sin el subcode no hay nada que permita afirmar que no es elegible.
    expect(explainPrivateReplyError(graphError(100))).toBeNull()
  })

  it("names the one-private-reply-per-comment limit on a 10900", () => {
    expect(explainPrivateReplyError(graphError(10900))).toContain(
      "exactly one per comment"
    )
  })

  it("shares the token, rate limit and block reasons across the three", () => {
    for (const code of [190, 613, 368]) {
      expect(explainMessageError(graphError(code))).toBe(
        explainCommentError(graphError(code))
      )
      expect(explainCommentError(graphError(code))).toBe(
        explainPrivateReplyError(graphError(code))
      )
    }
  })

  it("returns null for a code that is not in the catalogue", () => {
    expect(explainMessageError(graphError(999999))).toBeNull()
    expect(explainCommentError(null)).toBeNull()
    expect(explainPrivateReplyError({})).toBeNull()
  })
})
