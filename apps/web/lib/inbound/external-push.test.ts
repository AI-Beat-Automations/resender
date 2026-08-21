import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getSql: () => sqlMock,
}))

import { buildInboundPushPayload } from "./external-push"

const payload = {
  type: "message" as const,
  tenant: { id: "tenant-1" },
  page: {
    id: "page-row",
    channel: "messenger" as const,
    metaPageId: "meta-page",
    name: "Main Page",
    username: null,
  },
  conversation: { id: "conversation-1", contactId: "psid-1" },
  message: {
    id: "message-1",
    metaMessageId: "mid-1",
    eventType: "message" as const,
    postbackPayload: null,
    direction: "inbound" as const,
    status: "received" as const,
    text: "hola",
    attachment: null,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
}

describe("inbound push payload", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
    vi.unstubAllGlobals()
  })

  it("includes tenant, page, conversation and message context", () => {
    const result = buildInboundPushPayload({
      page: {
        id: "page-row",
        tenantId: "tenant-1",
        channel: "messenger",
        metaPageId: "meta-page",
        name: "Main Page",
        username: null,
        status: "active",
        tokenStatus: "valid",
        tokenError: null,
        tokenErrorAt: null,
        tokenExpiresAt: null,
        webhookUrl: "https://example.com/hook",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        disconnectedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      conversation: {
        id: "conversation-1",
        tenantId: "tenant-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        contactName: null,
        lastMessageAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      message: {
        id: "message-1",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        direction: "inbound",
        status: "received",
        text: "hola",
        metaMessageId: "mid-1",
        idempotencyKey: null,
        instagramSourceCommentId: null,
        attachmentType: null,
        attachmentUrl: null,
        attachmentMeta: null,
        error: null,
        providerResponse: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      eventType: "message",
      postbackPayload: null,
    })

    expect(result).toEqual(payload)
  })

  // Fabrica los tres argumentos que no cambian entre casos; cada test pisa
  // solo el message.
  const buildWith = (
    message: Partial<Parameters<typeof buildInboundPushPayload>[0]["message"]>
  ) =>
    buildInboundPushPayload({
      page: {
        id: "page-row",
        tenantId: "tenant-1",
        channel: "messenger",
        metaPageId: "meta-page",
        name: "Main Page",
        username: null,
        status: "active",
        tokenStatus: "valid",
        tokenError: null,
        tokenErrorAt: null,
        tokenExpiresAt: null,
        webhookUrl: "https://example.com/hook",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        disconnectedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      conversation: {
        id: "conversation-1",
        tenantId: "tenant-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        contactName: null,
        lastMessageAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      message: {
        id: "message-1",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        direction: "inbound",
        status: "received",
        text: "hola",
        metaMessageId: "mid-1",
        idempotencyKey: null,
        instagramSourceCommentId: null,
        attachmentType: null,
        attachmentUrl: null,
        attachmentMeta: null,
        error: null,
        providerResponse: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        ...message,
      },
      eventType: "message",
      postbackPayload: null,
    })

  // El split inverso del merge de `insertInboundMessage`: `title` sale del
  // jsonb hacia su campo propio y el resto queda ANIDADO en `details` — nada
  // de claves sueltas como `stickerId` o `booking` colgando de `attachment`.
  it("deriva el adjunto de la fila con los detalles anidados", () => {
    const result = buildWith({
      text: "",
      attachmentType: "reel",
      attachmentUrl: "https://cdn.meta.test/reel.mp4",
      attachmentMeta: { title: "Un reel", reelVideoId: "998877" },
    })

    expect(result.message.text).toBe("")
    expect(result.message.attachment).toEqual({
      type: "reel",
      url: "https://cdn.meta.test/reel.mp4",
      title: "Un reel",
      details: { reelVideoId: "998877" },
    })
  })

  it("deja details vacio cuando el meta guardado era vacio o null", () => {
    expect(
      buildWith({
        attachmentType: "image",
        attachmentUrl: "https://cdn.meta.test/foto.jpg",
        attachmentMeta: {},
      }).message.attachment
    ).toEqual({
      type: "image",
      url: "https://cdn.meta.test/foto.jpg",
      title: null,
      details: {},
    })

    expect(
      buildWith({
        attachmentType: "image",
        attachmentUrl: "https://cdn.meta.test/foto.jpg",
        attachmentMeta: null,
      }).message.attachment
    ).toEqual({
      type: "image",
      url: "https://cdn.meta.test/foto.jpg",
      title: null,
      details: {},
    })
  })

  it("manda attachment null explicito cuando no hubo adjunto", () => {
    const result = buildWith({})
    expect(result.message.attachment).toBeNull()
    expect("attachment" in result.message).toBe(true)
  })

})
