import { describe, expect, it } from "vitest"

import { extractInstagramDirectMessages } from "./instagram-webhook"

const IG_ACCOUNT = "17841400000000000"
const CONTACT = "1234567890"

const dm = (message: Record<string, unknown>, entryId = IG_ACCOUNT) => ({
  object: "instagram",
  entry: [
    {
      id: entryId,
      time: 1_769_000_000_000,
      messaging: [
        {
          sender: { id: CONTACT },
          recipient: { id: entryId },
          timestamp: 1_769_000_000_000,
          message,
        },
      ],
    },
  ],
})

describe("parser de mensajes directos de Instagram", () => {
  it("normaliza un DM de texto", () => {
    const [event] = extractInstagramDirectMessages(
      dm({ mid: "mid-1", text: "  hola  " })
    )

    expect(event).toEqual({
      eventType: "message",
      metaPageId: IG_ACCOUNT,
      senderId: CONTACT,
      text: "hola",
      attachment: null,
      metaMessageId: "mid-1",
      postbackPayload: null,
      timestamp: new Date(1_769_000_000_000),
    })
  })

  // Sin este filtro, cada respuesta que envía Resender vuelve como entrante, se
  // persiste como si fuera del contacto y se reenvía al webhook del tenant —que
  // típicamente contesta—, y la cuenta se responde a sí misma en bucle.
  it("descarta el eco de un mensaje que mandó la propia cuenta", () => {
    expect(
      extractInstagramDirectMessages(
        dm({ mid: "mid-echo", text: "respuesta nuestra", is_echo: true })
      )
    ).toEqual([])
  })

  // Deshacer el envío llega con el mismo `mid` que ya se procesó: no es un
  // mensaje nuevo.
  it("descarta un mensaje que el usuario deshizo", () => {
    expect(
      extractInstagramDirectMessages(
        dm({ mid: "mid-1", text: "ups", is_deleted: true })
      )
    ).toEqual([])
  })

  it("descarta un DM sin texto, como una foto o una respuesta a una historia", () => {
    expect(
      extractInstagramDirectMessages(
        dm({ mid: "mid-2", attachments: [{ type: "image" }] })
      )
    ).toEqual([])
    expect(
      extractInstagramDirectMessages(dm({ mid: "mid-3", text: "   " }))
    ).toEqual([])
  })

  // Los comentarios viajan en `entry[].changes[]`, en el mismo payload que los
  // DMs. Este parser no los toca: son otra tabla y otro parser.
  it("ignora los comentarios que vienen en changes", () => {
    expect(
      extractInstagramDirectMessages({
        object: "instagram",
        entry: [
          {
            id: IG_ACCOUNT,
            changes: [
              {
                field: "comments",
                value: { id: "comment-1", text: "un comentario" },
              },
            ],
          },
        ],
      })
    ).toEqual([])
  })

  it("toma la cuenta receptora de entry.id y no de recipient.id", () => {
    const payload = dm({ mid: "mid-1", text: "hola" })
    payload.entry[0]!.messaging[0]!.recipient = { id: "otra-cosa" }

    const [event] = extractInstagramDirectMessages(payload)

    expect(event?.metaPageId).toBe(IG_ACCOUNT)
  })

  it("acepta varios eventos y varias cuentas en un mismo payload", () => {
    const events = extractInstagramDirectMessages({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT,
          messaging: [
            {
              sender: { id: CONTACT },
              timestamp: 1_769_000_000_000,
              message: { mid: "mid-1", text: "uno" },
            },
            {
              sender: { id: CONTACT },
              timestamp: 1_769_000_000_001,
              message: { mid: "mid-echo", text: "eco", is_echo: true },
            },
          ],
        },
        {
          id: "17841400000000001",
          messaging: [
            {
              sender: { id: "otro-contacto" },
              timestamp: 1_769_000_000_002,
              message: { mid: "mid-2", text: "dos" },
            },
          ],
        },
      ],
    })

    expect(events.map((event) => event.metaMessageId)).toEqual([
      "mid-1",
      "mid-2",
    ])
  })

  it("cae a la hora de recepción cuando el timestamp no sirve", () => {
    const before = Date.now()
    const [event] = extractInstagramDirectMessages({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT,
          messaging: [
            {
              sender: { id: CONTACT },
              timestamp: "no es un número",
              message: { mid: "mid-1", text: "hola" },
            },
          ],
        },
      ],
    })

    expect(event?.timestamp.getTime()).toBeGreaterThanOrEqual(before)
  })

  // Un `mid` ausente deja el dedupe sin clave, y eso es información que la
  // ingesta necesita: mejor null explícito que un id inventado que nunca choca.
  it("deja el id del mensaje en null cuando Meta no lo manda", () => {
    const [event] = extractInstagramDirectMessages(dm({ text: "hola" }))

    expect(event?.metaMessageId).toBeNull()
  })

  it("tolera payloads inservibles sin lanzar", () => {
    expect(extractInstagramDirectMessages(null)).toEqual([])
    expect(extractInstagramDirectMessages("nope")).toEqual([])
    expect(extractInstagramDirectMessages({})).toEqual([])
    expect(extractInstagramDirectMessages({ entry: [{}] })).toEqual([])
    expect(
      extractInstagramDirectMessages({ entry: [{ id: 12345, messaging: [] }] })
    ).toEqual([])
  })
})
