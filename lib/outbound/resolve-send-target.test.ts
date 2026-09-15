import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getActivePageWithTokenByConnectionId: vi.fn(),
  getActivePageWithTokenForTenant: vi.fn(),
  getConversationById: vi.fn(),
  upsertConversation: vi.fn(),
}))

vi.mock("@/lib/messages/message-log", () => ({
  getConversationById: mocks.getConversationById,
  upsertConversation: mocks.upsertConversation,
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActivePageWithTokenByConnectionId:
    mocks.getActivePageWithTokenByConnectionId,
  getActivePageWithTokenForTenant: mocks.getActivePageWithTokenForTenant,
}))

import { resolveSendTarget } from "./resolve-send-target"

const messengerPage = {
  page: {
    id: "conn-1",
    tenantId: "tenant-1",
    channel: "messenger",
    metaPageId: "page-1",
    username: null,
  },
  pageAccessToken: "page-token-1",
}

const conversation = {
  id: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
  tenantId: "tenant-1",
  connectedPageId: "conn-1",
  contactId: "psid-1",
  lastInboundAt: null,
}

describe("resolveSendTarget", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
  })

  // Modo `conversation`: con el `conversation.id` del push alcanza. La página
  // sale por id de conexión —no por `meta_page_id`— y el token viene con ella.
  it("resolves page, token and conversation from conversationId alone", async () => {
    mocks.getConversationById.mockResolvedValue(conversation)
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(messengerPage)

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "messenger",
      target: { kind: "conversation", conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a" },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        page: messengerPage.page,
        pageAccessToken: "page-token-1",
        conversation,
      },
    })
    expect(mocks.getConversationById).toHaveBeenCalledWith("tenant-1", "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a")
    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      "tenant-1",
      "conn-1"
    )
    expect(mocks.getActivePageWithTokenForTenant).not.toHaveBeenCalled()
    expect(mocks.upsertConversation).not.toHaveBeenCalled()
  })

  // La consulta ya filtra por tenant, así que «de otro tenant» y «no existe»
  // son el mismo null: 404 sin decir cuál de los dos.
  it("404s an unknown or foreign conversationId", async () => {
    mocks.getConversationById.mockResolvedValue(null)

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "messenger",
      target: { kind: "conversation", conversationId: "c0ffee00-5555-4a6b-8c7d-9e0f1a2b3c4d" },
    })

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: "conversation not found",
      reason: "conversation_not_found",
    })
    expect(mocks.getActivePageWithTokenByConnectionId).not.toHaveBeenCalled()
  })

  it("404s a conversationId that is not a uuid without hitting the database", async () => {
    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "messenger",
      target: {
        kind: "conversation",
        conversationId: "m_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      },
    })

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: "conversation not found",
      reason: "conversation_not_found",
    })
    expect(mocks.getConversationById).not.toHaveBeenCalled()
  })

  it("404s when the conversation's page is no longer connected", async () => {
    mocks.getConversationById.mockResolvedValue(conversation)
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(null)

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "whatsapp",
      target: { kind: "conversation", conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a" },
    })

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: "WhatsApp number is not connected for this tenant",
      reason: "page_not_connected",
      errorMessage: "connectionId=conn-1",
    })
  })

  // Una conversación de Instagram mandada a la ruta de Messenger: 400 con
  // código y con la ruta correcta en el texto, para que el cliente arregle la
  // URL en vez de adivinar.
  it("400s with conversation_channel_mismatch and names the right route", async () => {
    mocks.getConversationById.mockResolvedValue(conversation)
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      ...messengerPage,
      page: { ...messengerPage.page, channel: "instagram" },
    })

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "messenger",
      target: { kind: "conversation", conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a" },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: "conversation_channel_mismatch",
      error: "conversation belongs to instagram; use /api/meta/instagram/send",
      reason: "invalid_request",
    })
  })

  // Modo `contact`: lo que hacían las rutas inline, con el canal explícito en
  // la búsqueda y el upsert de la conversación.
  it("looks the page up by metaPageId and upserts the conversation", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(messengerPage)
    mocks.upsertConversation.mockResolvedValue(conversation)

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "messenger",
      target: { kind: "contact", pageId: "page-1", recipientId: "psid-1" },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        page: messengerPage.page,
        pageAccessToken: "page-token-1",
        conversation,
      },
    })
    expect(mocks.getActivePageWithTokenForTenant).toHaveBeenCalledWith(
      "tenant-1",
      "page-1",
      "messenger"
    )
    expect(mocks.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        connectedPageId: "conn-1",
        contactId: "psid-1",
      })
    )
    expect(mocks.getConversationById).not.toHaveBeenCalled()
  })

  it("404s an unknown page in contact mode with the channel's message", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(null)

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "instagram",
      target: { kind: "contact", pageId: "ig-9", recipientId: "igsid-1" },
    })

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: "Instagram account is not connected for this tenant",
      reason: "page_not_connected",
      errorMessage: "accountId=ig-9",
    })
    expect(mocks.upsertConversation).not.toHaveBeenCalled()
  })

  // Los tres campos juntos tienen que contar la misma historia.
  it("400s when conversationId does not match pageId and recipientId", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(messengerPage)
    mocks.getConversationById.mockResolvedValue({
      ...conversation,
      id: "9b8a7c6d-2222-4f0e-9d1c-3b4a5f6e7d8c",
      contactId: "otro-psid",
    })

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "messenger",
      target: {
        kind: "contact",
        pageId: "page-1",
        recipientId: "psid-1",
        conversationId: "9b8a7c6d-2222-4f0e-9d1c-3b4a5f6e7d8c",
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "conversationId does not match pageId and recipientId",
      reason: "invalid_request",
    })
    expect(mocks.upsertConversation).not.toHaveBeenCalled()
  })

  it("accepts the three fields when they agree", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(messengerPage)
    mocks.getConversationById.mockResolvedValue(conversation)

    const result = await resolveSendTarget({
      tenantId: "tenant-1",
      channel: "messenger",
      target: {
        kind: "contact",
        pageId: "page-1",
        recipientId: "psid-1",
        conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      },
    })

    expect(result).toMatchObject({ ok: true, value: { conversation } })
    expect(mocks.upsertConversation).not.toHaveBeenCalled()
  })
})
