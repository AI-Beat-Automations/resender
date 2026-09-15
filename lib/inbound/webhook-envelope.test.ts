import { describe, expect, it } from "vitest"

import { describeWebhookEnvelope } from "./webhook-envelope"

describe("describeWebhookEnvelope", () => {
  it("cuenta los DMs de un sobre de mensajería", () => {
    expect(
      describeWebhookEnvelope({
        object: "instagram",
        entry: [
          {
            id: "17841426388985797",
            messaging: [{ message: { mid: "m1" } }, { message: { mid: "m2" } }],
          },
        ],
      })
    ).toEqual({
      entryCount: 1,
      messagingCount: 2,
      changeCount: 0,
      fields: [],
    })
  })

  it("cuenta la forma `changes[]` de Facebook Login", () => {
    expect(
      describeWebhookEnvelope({
        entry: [{ id: "1", changes: [{ field: "comments", value: {} }] }],
      })
    ).toMatchObject({ changeCount: 1, fields: ["comments"] })
  })

  it("cuenta la forma plana de Instagram Login", () => {
    // El evento viaja sobre el `entry` mismo. Es la forma que la etapa 5
    // descubrió que era la real para nuestro login, y contarla distinto haría
    // que el sobre pareciera vacío justo cuando no lo está.
    expect(
      describeWebhookEnvelope({
        entry: [{ id: "1", field: "comments", value: { id: "c1" } }],
      })
    ).toMatchObject({ changeCount: 1, fields: ["comments"] })
  })

  it("distingue live_comments de comments", () => {
    // Con esto, cero eventos ingeridos deja de ser un misterio: el sobre dice
    // que lo que llegó era `live_comments`, que está fuera de alcance.
    expect(
      describeWebhookEnvelope({
        entry: [{ id: "1", field: "live_comments", value: {} }],
      })
    ).toMatchObject({ fields: ["live_comments"] })
  })

  it("suma un DM y un comentario del mismo POST", () => {
    // Meta manda las dos cosas en el mismo payload, en ramas distintas.
    expect(
      describeWebhookEnvelope({
        entry: [
          {
            id: "1",
            messaging: [{ message: { mid: "m1" } }],
            changes: [{ field: "comments", value: {} }],
          },
          { id: "1", field: "comments", value: {} },
        ],
      })
    ).toEqual({
      entryCount: 2,
      messagingCount: 1,
      changeCount: 2,
      fields: ["comments"],
    })
  })

  it("deduplica y ordena los campos", () => {
    expect(
      describeWebhookEnvelope({
        entry: [
          { changes: [{ field: "comments" }, { field: "live_comments" }] },
          { changes: [{ field: "comments" }] },
        ],
      })
    ).toMatchObject({ changeCount: 3, fields: ["comments", "live_comments"] })
  })

  it("devuelve ceros ante cualquier cosa que no sea un sobre", () => {
    const empty = {
      entryCount: 0,
      messagingCount: 0,
      changeCount: 0,
      fields: [],
    }
    for (const body of [null, undefined, "texto", 42, {}, { entry: "no" }]) {
      expect(describeWebhookEnvelope(body)).toEqual(empty)
    }
  })

  it("no devuelve nada del contenido", () => {
    // El sobre se describe con conteos. Si alguna vez alguien agrega un campo
    // que arrastre el payload, este test lo frena.
    const shape = describeWebhookEnvelope({
      entry: [
        {
          id: "1",
          messaging: [{ message: { mid: "m1", text: "mi tarjeta es 4111" } }],
        },
      ],
    })
    expect(JSON.stringify(shape)).not.toContain("4111")
  })
})
