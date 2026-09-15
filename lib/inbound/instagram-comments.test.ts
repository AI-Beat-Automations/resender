import { describe, expect, it } from "vitest"

import { extractInstagramComments } from "./instagram-comments"

const IG_ACCOUNT = "17841400000000000"
const COMMENTER = "9876543210"

const value = (overrides: Record<string, unknown> = {}) => ({
  id: "comment-1",
  from: { id: COMMENTER, username: "un_seguidor" },
  text: "  qué bueno esto  ",
  media: { id: "media-1", media_product_type: "FEED" },
  ...overrides,
})

// La forma que manda Meta con Instagram Login: `field` y `value` planos sobre
// el entry, sin array de cambios.
const instagramLogin = (v: Record<string, unknown> = value()) => ({
  object: "instagram",
  entry: [{ id: IG_ACCOUNT, time: 1_769_000_000, field: "comments", value: v }],
})

// La forma que manda con Facebook Login for Business: array `changes`, y el id
// del comentario viene en `comment_id` en vez de en `id`.
const facebookLogin = (v: Record<string, unknown>) => ({
  object: "instagram",
  entry: [
    {
      id: IG_ACCOUNT,
      time: 1_769_000_000,
      changes: [{ field: "comments", value: v }],
    },
  ],
})

describe("parser de comentarios de Instagram", () => {
  it("normaliza la forma plana de Instagram Login", () => {
    const [event] = extractInstagramComments(instagramLogin())

    expect(event).toEqual({
      igCommentId: "comment-1",
      parentIgCommentId: null,
      metaPageId: IG_ACCOUNT,
      mediaId: "media-1",
      mediaProductType: "FEED",
      fromIgId: COMMENTER,
      fromUsername: "un_seguidor",
      text: "qué bueno esto",
      timestamp: new Date(1_769_000_000 * 1000),
    })
  })

  // Asumir una sola forma significa que si Meta manda la otra el sistema queda
  // mudo sin un solo error en los logs: el peor modo de falla de un webhook.
  it("normaliza también la forma con changes y comment_id", () => {
    const [event] = extractInstagramComments(
      facebookLogin({
        comment_id: "comment-2",
        parent_id: "comment-1",
        from: { id: COMMENTER, username: "un_seguidor" },
        text: "respondiendo",
        media: { id: "media-1", media_product_type: "FEED" },
      })
    )

    expect(event?.igCommentId).toBe("comment-2")
    expect(event?.parentIgCommentId).toBe("comment-1")
  })

  // **El filtro anti-bucle.** La respuesta pública que publica Resender vuelve
  // como webhook `comments`; sin descartarla el sistema responde su propia
  // respuesta indefinidamente. A diferencia de los DMs no hay `is_echo`.
  it("descarta el comentario que publicó la propia cuenta", () => {
    expect(
      extractInstagramComments(
        instagramLogin(
          value({ from: { id: IG_ACCOUNT, username: "nosotros" } })
        )
      )
    ).toEqual([])
  })

  it("no descarta a un tercero que comenta en la misma publicación", () => {
    expect(extractInstagramComments(instagramLogin())).toHaveLength(1)
  })

  // `live_comments` es otro campo y queda fuera de alcance; sin el filtro
  // entraría por la misma puerta y se guardaría como un comentario común.
  it("ignora los campos que no son comments", () => {
    expect(
      extractInstagramComments({
        entry: [
          { id: IG_ACCOUNT, field: "live_comments", value: value() },
          { id: IG_ACCOUNT, field: "mentions", value: value() },
        ],
      })
    ).toEqual([])
  })

  // `media_id` es `not null` en la tabla: sin él no hay publicación a la cual
  // colgar el comentario, y un placeholder rompería el índice del hilo.
  it("descarta un comentario sin media, sin autor o sin texto", () => {
    expect(
      extractInstagramComments(instagramLogin(value({ media: undefined })))
    ).toEqual([])
    expect(
      extractInstagramComments(instagramLogin(value({ from: undefined })))
    ).toEqual([])
    expect(
      extractInstagramComments(instagramLogin(value({ text: "   " })))
    ).toEqual([])
    expect(
      extractInstagramComments(
        instagramLogin(value({ id: undefined, comment_id: undefined }))
      )
    ).toEqual([])
  })

  it("acepta un comentario sin username y sin media_product_type", () => {
    const [event] = extractInstagramComments(
      instagramLogin(
        value({ from: { id: COMMENTER }, media: { id: "media-1" } })
      )
    )

    expect(event?.fromUsername).toBeNull()
    expect(event?.mediaProductType).toBeNull()
  })

  // `entry.time` viene en segundos en los webhooks de comentarios y en
  // milisegundos en los de mensajes. Interpretar segundos como milisegundos
  // fecharía todos los comentarios en 1970 y rompería el orden del hilo.
  it("interpreta entry.time en segundos y también en milisegundos", () => {
    const [enSegundos] = extractInstagramComments({
      entry: [
        {
          id: IG_ACCOUNT,
          time: 1_769_000_000,
          field: "comments",
          value: value(),
        },
      ],
    })
    const [enMillis] = extractInstagramComments({
      entry: [
        {
          id: IG_ACCOUNT,
          time: 1_769_000_000_000,
          field: "comments",
          value: value(),
        },
      ],
    })

    expect(enSegundos?.timestamp.getUTCFullYear()).toBeGreaterThan(2020)
    expect(enMillis?.timestamp.getTime()).toBe(enSegundos?.timestamp.getTime())
  })

  it("acepta varios comentarios y varias cuentas en un payload", () => {
    const events = extractInstagramComments({
      entry: [
        {
          id: IG_ACCOUNT,
          time: 1_769_000_000,
          changes: [
            { field: "comments", value: value({ id: "c1" }) },
            {
              field: "comments",
              value: value({
                id: "c2",
                from: { id: IG_ACCOUNT, username: "nosotros" },
              }),
            },
          ],
        },
        {
          id: "17841400000000001",
          time: 1_769_000_000,
          field: "comments",
          value: value({ id: "c3" }),
        },
      ],
    })

    expect(events.map((e) => e.igCommentId)).toEqual(["c1", "c3"])
  })

  it("tolera payloads inservibles sin lanzar", () => {
    expect(extractInstagramComments(null)).toEqual([])
    expect(extractInstagramComments("nope")).toEqual([])
    expect(extractInstagramComments({})).toEqual([])
    expect(extractInstagramComments({ entry: [{}] })).toEqual([])
    expect(
      extractInstagramComments({ entry: [{ id: 1234, field: "comments" }] })
    ).toEqual([])
  })

  // Los DMs viajan en `messaging` dentro del mismo payload; este parser no los
  // toca, igual que el de DMs no toca los comentarios.
  it("ignora los mensajes directos del mismo payload", () => {
    expect(
      extractInstagramComments({
        entry: [
          {
            id: IG_ACCOUNT,
            messaging: [
              {
                sender: { id: COMMENTER },
                message: { mid: "mid-1", text: "un DM" },
              },
            ],
          },
        ],
      })
    ).toEqual([])
  })
})
