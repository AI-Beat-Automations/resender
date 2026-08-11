import { describe, expect, it } from "vitest"

import { extractInstagramComments } from "./instagram-comments"

const IG_ACCOUNT = "17841400000000000"

const flat = (value: Record<string, unknown>, field = "comments") => ({
  object: "instagram",
  entry: [{ id: IG_ACCOUNT, time: 1_769_000_000, field, value }],
})

const nested = (value: Record<string, unknown>, field = "comments") => ({
  object: "instagram",
  entry: [{ id: IG_ACCOUNT, time: 1_769_000_000, changes: [{ field, value }] }],
})

const thirdPartyComment = (overrides: Record<string, unknown> = {}) => ({
  id: "ig-comment-1",
  from: { id: "9876543210", username: "un_seguidor" },
  text: "qué bueno",
  media: { id: "media-1", media_product_type: "FEED" },
  ...overrides,
})

describe("Instagram comments", () => {
  // Meta describe las dos formas para el mismo campo. Asumir una sola significa
  // que si llega la otra el sistema queda mudo sin un solo error en los logs.
  it("accepts the flat Instagram Login shape and the nested Facebook Login one", () => {
    const fromFlat = extractInstagramComments(flat(thirdPartyComment()))
    const fromNested = extractInstagramComments(
      nested({
        ...thirdPartyComment(),
        id: undefined,
        comment_id: "ig-comment-1",
      })
    )

    expect(fromFlat).toHaveLength(1)
    expect(fromNested).toHaveLength(1)
    expect(fromFlat[0]!.providerCommentId).toBe("ig-comment-1")
    // `value.id` en Instagram Login, `value.comment_id` en Facebook Login.
    expect(fromNested[0]!.providerCommentId).toBe("ig-comment-1")
  })

  it("carries the parent comment, the media and who commented", () => {
    const [event] = extractInstagramComments(
      flat(thirdPartyComment({ parent_id: "ig-comment-root" }))
    )

    expect(event).toMatchObject({
      providerAccountId: IG_ACCOUNT,
      parentCommentId: "ig-comment-root",
      mediaId: "media-1",
      mediaProductType: "FEED",
      fromProviderUserId: "9876543210",
      fromUsername: "un_seguidor",
      text: "qué bueno",
    })
  })

  // Primera señal anti-bucle: la respuesta pública que publica Resender vuelve
  // como webhook `comments`, y en comentarios no hay `is_echo`.
  it("drops a comment written by the account itself", () => {
    expect(
      extractInstagramComments(
        flat(
          thirdPartyComment({ from: { id: IG_ACCOUNT, username: "cuenta" } })
        )
      )
    ).toEqual([])
  })

  it("drops live_comments, which is a different field", () => {
    expect(
      extractInstagramComments(flat(thirdPartyComment(), "live_comments"))
    ).toEqual([])
  })

  it("drops comments without media, which the table requires", () => {
    expect(
      extractInstagramComments(flat(thirdPartyComment({ media: undefined })))
    ).toEqual([])
  })

  // `entry.time` viene en segundos en los webhooks de comentarios y en
  // milisegundos en los de mensajes. Leer segundos como milisegundos fecharía
  // todos los comentarios en 1970 y rompería el orden del hilo.
  it("reads entry.time in seconds without landing in 1970", () => {
    const [event] = extractInstagramComments(flat(thirdPartyComment()))

    expect(event!.createdAt.toISOString()).toBe("2026-01-21T12:53:20.000Z")
    expect(event!.createdAt.getUTCFullYear()).toBe(2026)
  })

  it("still reads a millisecond timestamp, distinguishing by magnitude", () => {
    const [event] = extractInstagramComments({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT,
          time: 1_769_000_000_000,
          field: "comments",
          value: thirdPartyComment(),
        },
      ],
    })

    expect(event!.createdAt.toISOString()).toBe("2026-01-21T12:53:20.000Z")
  })
})
