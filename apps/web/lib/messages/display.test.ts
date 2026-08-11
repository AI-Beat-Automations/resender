import { describe, expect, it } from "vitest"

import {
  NO_MESSAGES_CONTENT,
  formatContactLabel,
  toConversationRowView,
  toThreadMessageViews,
} from "./display"
import type { ConversationListItem, ThreadMessage } from "./read-model"

const NOW = new Date(2026, 6, 27, 15, 30)

function conversation(
  overrides: Partial<ConversationListItem> = {}
): ConversationListItem {
  return {
    id: "conv-1",
    contactId: "8837120041",
    contactName: null,
    lastMessageAt: new Date(2026, 6, 27, 14, 2),
    page: {
      id: "page-1",
      channel: "messenger",
      metaPageId: "104233889761204",
      name: "Café Rioja",
      username: null,
    },
    latestMessage: {
      text: "¿Hacen envíos a Palermo?",
      direction: "inbound",
      status: "received",
      createdAt: new Date(2026, 6, 27, 14, 2),
    },
    ...overrides,
  }
}

function message(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "msg-1",
    direction: "inbound",
    status: "received",
    text: "Hola, ¿tienen turno para hoy?",
    error: null,
    instagramSourceCommentId: null,
    createdAt: new Date(2026, 6, 27, 14, 1, 29),
    ...overrides,
  }
}

describe("message display helpers", () => {
  it("falls back to a human-readable PSID label", () => {
    expect(formatContactLabel(null, "12345")).toBe("PSID 12345")
    expect(formatContactLabel("", "12345")).toBe("PSID 12345")
    expect(formatContactLabel("Ada", "12345")).toBe("Ada")
  })
})

describe("toConversationRowView", () => {
  it("identifica al contacto siempre por PSID, aunque hubiera nombre", () => {
    // Invariante de la ADR 0005: `contact_name` nunca se escribe, así que la
    // fila del log no puede depender de él ni siquiera cuando viene informado.
    expect(toConversationRowView(conversation(), NOW).contactLabel).toBe(
      "psid 8837120041"
    )
    expect(
      toConversationRowView(conversation({ contactName: "Martina G." }), NOW)
        .contactLabel
    ).toBe("psid 8837120041")
  })

  it("pone el último mensaje en el renglón principal", () => {
    const row = toConversationRowView(conversation(), NOW)

    expect(row.content).toBe("¿Hacen envíos a Palermo?")
    expect(row.hasMessages).toBe(true)
    expect(row.failed).toBe(false)
    expect(row.pageLabel).toBe("Café Rioja · 104233889761204")
    expect(row.channel).toBe("messenger")
    expect(row.timestamp).toBe("hoy 14:02")
  })

  it("identifica la cuenta por @handle cuando la conversación es de Instagram", () => {
    const row = toConversationRowView(
      conversation({
        page: {
          id: "page-2",
          channel: "instagram",
          metaPageId: "17841400000000000",
          name: "Café Rioja",
          username: "cafe.rioja",
        },
      }),
      NOW
    )

    expect(row.pageLabel).toBe("@cafe.rioja · ig_id 17841400000000000")
    expect(row.channel).toBe("instagram")
  })

  it("cae al nombre de la cuenta si Instagram no dio el @handle", () => {
    const row = toConversationRowView(
      conversation({
        page: {
          id: "page-2",
          channel: "instagram",
          metaPageId: "17841400000000000",
          name: "Café Rioja",
          username: null,
        },
      }),
      NOW
    )

    expect(row.pageLabel).toBe("Café Rioja · 17841400000000000")
  })

  it("prefija los salientes con «Tú: » y marca los fallidos", () => {
    const row = toConversationRowView(
      conversation({
        latestMessage: {
          text: "Te confirmo el turno del jueves.",
          direction: "outbound",
          status: "failed",
          createdAt: new Date(2026, 6, 26, 19, 12),
        },
        lastMessageAt: new Date(2026, 6, 26, 19, 12),
      }),
      NOW
    )

    expect(row.content).toBe("Tú: Te confirmo el turno del jueves.")
    expect(row.failed).toBe(true)
    expect(row.timestamp).toBe("ayer 19:12")
  })

  it("resuelve la conversación sin mensajes", () => {
    const row = toConversationRowView(
      conversation({ latestMessage: null }),
      NOW
    )

    expect(row.content).toBe(NO_MESSAGES_CONTENT)
    expect(row.hasMessages).toBe(false)
    expect(row.failed).toBe(false)
  })
})

describe("toThreadMessageViews", () => {
  it("compone el metadato y solo abre separador al cambiar de día", () => {
    const views = toThreadMessageViews([
      message({ id: "a", createdAt: new Date(2026, 6, 26, 19, 12, 3) }),
      message({
        id: "b",
        direction: "outbound",
        status: "sent",
        text: "¡Sí! Te espero hoy a las 15:00 👍",
        createdAt: new Date(2026, 6, 27, 14, 2, 11),
      }),
      message({ id: "c", createdAt: new Date(2026, 6, 27, 14, 2, 40) }),
    ])

    expect(views.map((view) => view.dayLabel)).toEqual([
      "26 jul 2026",
      "27 jul 2026",
      null,
    ])
    expect(views[1]?.meta).toBe("outbound · 14:02:11 · sent")
    expect(views[1]?.outbound).toBe(true)
    expect(views[2]?.meta).toBe("inbound · 14:02:40 · received")
  })

  it("solo expone el error del proveedor en los mensajes fallidos", () => {
    const [failed, sent] = toThreadMessageViews([
      message({
        id: "a",
        direction: "outbound",
        status: "failed",
        error: "OAuthException 190 · Error validating access token",
        createdAt: new Date(2026, 6, 27, 14, 5, 2),
      }),
      message({
        id: "b",
        direction: "outbound",
        status: "sent",
        error: "ruido que no debería pintarse",
        createdAt: new Date(2026, 6, 27, 14, 6, 0),
      }),
    ])

    expect(failed?.failed).toBe(true)
    expect(failed?.error).toBe(
      "OAuthException 190 · Error validating access token"
    )
    expect(failed?.meta).toBe("outbound · 14:05:02 · failed")
    expect(sent?.failed).toBe(false)
    expect(sent?.error).toBeNull()
  })

  it("marca la respuesta privada a un comentario, que es un DM como cualquier otro", () => {
    const [privateReply, plain] = toThreadMessageViews([
      message({
        id: "a",
        direction: "outbound",
        status: "sent",
        instagramSourceCommentId: "17851400000000000",
        createdAt: new Date(2026, 6, 27, 14, 2, 11),
      }),
      message({
        id: "b",
        direction: "outbound",
        status: "sent",
        createdAt: new Date(2026, 6, 27, 14, 3, 0),
      }),
    ])

    expect(privateReply?.fromComment).toBe(true)
    expect(privateReply?.meta).toBe(
      "outbound · 14:02:11 · sent · respuesta a comentario"
    )
    expect(plain?.fromComment).toBe(false)
    expect(plain?.meta).toBe("outbound · 14:03:00 · sent")
  })
})
