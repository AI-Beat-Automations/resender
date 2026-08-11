import { describe, expect, it } from "vitest"

import { extractInstagramComments } from "./instagram-comments"
import { extractInstagramDirectMessages } from "./instagram-events"

const IG_ACCOUNT = "17841400000000000"

const messagingPayload = (message: Record<string, unknown>) => ({
  object: "instagram",
  entry: [
    {
      id: IG_ACCOUNT,
      messaging: [
        {
          sender: { id: "igsid-1" },
          recipient: { id: IG_ACCOUNT },
          timestamp: 1_769_000_000_000,
          message,
        },
      ],
    },
  ],
})

describe("Instagram direct messages", () => {
  it("extracts a text message with the receiving account taken from entry.id", () => {
    expect(
      extractInstagramDirectMessages(
        messagingPayload({ mid: "mid-1", text: "  hola  " })
      )
    ).toEqual([
      {
        providerAccountId: IG_ACCOUNT,
        senderId: "igsid-1",
        text: "hola",
        providerMessageId: "mid-1",
        createdAt: new Date(1_769_000_000_000),
      },
    ])
  })

  // Sin este filtro, cada respuesta que envía Resender vuelve como evento
  // entrante, se persiste como si fuera del contacto y se reenvía al webhook del
  // tenant, que típicamente contesta: la cuenta termina hablando sola.
  it("drops echoes before anything else", () => {
    expect(
      extractInstagramDirectMessages(
        messagingPayload({ mid: "mid-echo", text: "eco", is_echo: true })
      )
    ).toEqual([])
  })

  // En Instagram el usuario puede deshacer el envío: llega el mismo mid marcado
  // como borrado, y eso no es un mensaje nuevo.
  it("drops unsent messages", () => {
    expect(
      extractInstagramDirectMessages(
        messagingPayload({ mid: "mid-1", text: "hola", is_deleted: true })
      )
    ).toEqual([])
  })

  it("ignores messages without a mid or without text", () => {
    expect(
      extractInstagramDirectMessages(messagingPayload({ text: "hola" }))
    ).toEqual([])
    expect(
      extractInstagramDirectMessages(
        messagingPayload({ mid: "mid-1", text: "   " })
      )
    ).toEqual([])
  })

  // Los comentarios viajan en la otra rama del mismo payload y son otra tabla y
  // otro parser.
  it("does not pick up comments that travel in the same payload", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT,
          field: "comments",
          value: {
            id: "ig-comment-1",
            from: { id: "9876543210", username: "un_seguidor" },
            text: "un comentario",
            media: { id: "media-1" },
          },
        },
      ],
    }

    expect(extractInstagramDirectMessages(payload)).toEqual([])
    expect(extractInstagramComments(payload)).toHaveLength(1)
  })
})
