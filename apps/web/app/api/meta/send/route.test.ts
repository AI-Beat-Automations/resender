import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getActivePageWithTokenByConnectionId: vi.fn(),
  getActivePageWithTokenForTenant: vi.fn(),
  getConversationById: vi.fn(),
  getOutboundMessageByIdempotencyKey: vi.fn(),
  getTenantEntitlement: vi.fn(),
  hasActiveSubscription: vi.fn(),
  incrementUsage: vi.fn(),
  insertOutboundMessage: vi.fn(),
  isUserWaitlisted: vi.fn(),
  log: vi.fn(),
  markPageTokenInvalid: vi.fn(),
  sendMetaMessage: vi.fn(),
  upsertConversation: vi.fn(),
}))

vi.mock("@/lib/auth/api-keys", () => ({
  authenticateApiKey: mocks.authenticateApiKey,
}))

vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))

vi.mock("@/lib/billing/entitlement-status", () => ({
  getTenantEntitlement: mocks.getTenantEntitlement,
}))

vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

vi.mock("@/lib/billing/usage-counter", () => ({
  incrementUsage: mocks.incrementUsage,
}))

vi.mock("@/lib/messages/message-log", () => ({
  getConversationById: mocks.getConversationById,
  getOutboundMessageByIdempotencyKey: mocks.getOutboundMessageByIdempotencyKey,
  insertOutboundMessage: mocks.insertOutboundMessage,
  upsertConversation: mocks.upsertConversation,
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActivePageWithTokenByConnectionId:
    mocks.getActivePageWithTokenByConnectionId,
  getActivePageWithTokenForTenant: mocks.getActivePageWithTokenForTenant,
  markPageTokenInvalid: mocks.markPageTokenInvalid,
}))

// Solo `sendMetaMessage` sale a la red; los helpers de parseo de errores son
// puros y se dejan con su comportamiento real para no falsear la traducción.
vi.mock("@/lib/outbound/meta-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outbound/meta-send")>()),
  sendMetaMessage: mocks.sendMetaMessage,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null, captureDeferred: vi.fn() }))

import type { NextRequest } from "next/server"

import { POST } from "./route"

const sendRequest = (body: Record<string, unknown>) =>
  new Request("https://resender.test/api/meta/send", {
    method: "POST",
    headers: { authorization: "Bearer rk_test" },
    body: JSON.stringify({ pageId: "page-1", recipientId: "psid-1", ...body }),
  }) as unknown as NextRequest

// Sin `pageId` ni `recipientId`: la forma de la ADR 0019.
const sendByConversation = (body: Record<string, unknown>) =>
  new Request("https://resender.test/api/meta/send", {
    method: "POST",
    headers: { authorization: "Bearer rk_test" },
    body: JSON.stringify({ conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a", ...body }),
  }) as unknown as NextRequest

const attachment = {
  type: "image",
  url: "https://cdn.example.com/foto.png",
}

describe("POST /api/meta/send", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.authenticateApiKey.mockResolvedValue({ tenantId: "tenant-1" })
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue({
      block: null,
      periodStart: new Date("2026-08-01"),
    })
    mocks.getActivePageWithTokenForTenant.mockResolvedValue({
      page: {
        id: "conn-1",
        tenantId: "tenant-1",
        channel: "messenger",
        metaPageId: "page-1",
        username: null,
      },
      pageAccessToken: "page-token-1",
    })
    mocks.upsertConversation.mockResolvedValue({
      id: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      connectedPageId: "conn-1",
      contactId: "psid-1",
    })
    // Devuelve lo que persistió, que es lo que la ruta refleja en la respuesta.
    mocks.insertOutboundMessage.mockImplementation(
      async (input: { conversationId: string; status: string }) => ({
        id: "msg-1",
        conversationId: input.conversationId,
        status: input.status,
      })
    )
    mocks.sendMetaMessage.mockResolvedValue({
      ok: true,
      status: 200,
      data: { message_id: "mid-1" },
      error: null,
      reason: null,
      code: null,
    })
  })

  // El contrato hacia afuera de la verificación de API key: 401 con `error:
  // "unauthorized"` y nada más. Vale igual para una key inventada, una revocada
  // y una vencida; el plugin distingue esos casos y `lib/auth/api-keys.ts` los
  // colapsa en `null` a propósito, para no decirle a quien prueba credenciales
  // cuál de las tres acertó.
  it("rejects a request without a valid API key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await POST(sendRequest({ reply: "hola" }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.sendMetaMessage).not.toHaveBeenCalled()
    expect(mocks.insertOutboundMessage).not.toHaveBeenCalled()
  })

  // El XOR del parser: `reply` y `attachment` juntos es un 400 con código
  // estable, para que el cliente lo distinga sin parsear prosa.
  it("rejects reply and attachment together with a stable code", async () => {
    const response = await POST(sendRequest({ reply: "hola", attachment }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("send_target_conflict")
    expect(typeof body.error).toBe("string")
    expect(mocks.sendMetaMessage).not.toHaveBeenCalled()
    expect(mocks.insertOutboundMessage).not.toHaveBeenCalled()
  })

  // Camino feliz del adjunto: a Meta va `{ attachment }`, se persiste el
  // adjunto con texto vacío, y la respuesta no gana ningún `code`.
  it("sends an attachment by URL and persists it", async () => {
    const response = await POST(sendRequest({ attachment }))

    expect(response.status).toBe(200)
    expect(mocks.sendMetaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page-1",
        pageAccessToken: "page-token-1",
        recipientId: "psid-1",
        message: { attachment },
      })
    )
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        attachment,
        status: "sent",
      })
    )
    const body = await response.json()
    expect(body.resender.status).toBe("sent")
    expect("code" in body).toBe(false)
  })

  // Meta no pudo descargar el archivo (100/2018047): se persiste el fallo y el
  // código estable viaja en el body junto al passthrough del status de Meta.
  it("surfaces Meta attachment failures with their stable code", async () => {
    mocks.sendMetaMessage.mockResolvedValue({
      ok: false,
      status: 400,
      data: { error: { message: "boom", code: 100, error_subcode: 2018047 } },
      error: "boom",
      reason:
        "Meta couldn't download the attachment from its URL. Make sure the URL is publicly reachable over https, without auth and without broken redirects.",
      code: "attachment_fetch_failed",
    })

    const response = await POST(sendRequest({ attachment }))

    expect(response.status).toBe(400)
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    )
    const body = await response.json()
    expect(body.code).toBe("attachment_fetch_failed")
    expect(body.resender.status).toBe("failed")
  })

  // Los 4xx que ya existían no ganan `code`: el contrato viejo queda intacto.
  it("keeps the legacy 4xx bodies without a code", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const response = await POST(sendRequest({ reply: "hola" }))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toEqual({ error: "no active subscription" })
    expect("code" in body).toBe(false)
    expect(mocks.sendMetaMessage).not.toHaveBeenCalled()
  })

  // El envío de texto de siempre no cambia: `{ text }` hacia Meta y ningún
  // adjunto persistido.
  it("still sends plain text replies unchanged", async () => {
    const response = await POST(sendRequest({ reply: "hola" }))

    expect(response.status).toBe(200)
    expect(mocks.sendMetaMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: { text: "hola" } })
    )
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "hola", attachment: null })
    )
    const body = await response.json()
    expect(body.resender.status).toBe("sent")
  })

  // ADR 0019: con el `conversation.id` del push alcanza. La página sale por id
  // de conexión, el destinatario de la conversación, y a Meta va lo mismo que
  // con el par `pageId` + `recipientId`.
  it("sends with conversationId alone", async () => {
    mocks.getConversationById.mockResolvedValue({
      id: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      connectedPageId: "conn-1",
      contactId: "psid-1",
    })
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: {
        id: "conn-1",
        tenantId: "tenant-1",
        channel: "messenger",
        metaPageId: "page-1",
        username: null,
      },
      pageAccessToken: "page-token-1",
    })

    const response = await POST(sendByConversation({ reply: "hola" }))

    expect(response.status).toBe(200)
    expect(mocks.getConversationById).toHaveBeenCalledWith("tenant-1", "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a")
    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      "tenant-1",
      "conn-1"
    )
    expect(mocks.getActivePageWithTokenForTenant).not.toHaveBeenCalled()
    expect(mocks.upsertConversation).not.toHaveBeenCalled()
    expect(mocks.sendMetaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page-1",
        pageAccessToken: "page-token-1",
        recipientId: "psid-1",
        message: { text: "hola" },
      })
    )
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
        connectedPageId: "conn-1",
        contactId: "psid-1",
      })
    )
    const body = await response.json()
    expect(body.resender).toEqual({
      conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      messageId: "msg-1",
      status: "sent",
    })
  })

  // Una conversación de Instagram en la ruta de Messenger: 400 con código y
  // la ruta correcta en el texto.
  it("400s a conversation from another channel", async () => {
    mocks.getConversationById.mockResolvedValue({
      id: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      connectedPageId: "conn-ig",
      contactId: "igsid-1",
    })
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: {
        id: "conn-ig",
        tenantId: "tenant-1",
        channel: "instagram",
        metaPageId: "ig-1",
        username: "cuenta",
      },
      pageAccessToken: "ig-token-1",
    })

    const response = await POST(sendByConversation({ reply: "hola" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: "conversation_channel_mismatch",
      error: "conversation belongs to instagram; use /api/meta/instagram/send",
    })
    expect(mocks.sendMetaMessage).not.toHaveBeenCalled()
    expect(mocks.insertOutboundMessage).not.toHaveBeenCalled()
  })

  it("404s an unknown conversationId", async () => {
    mocks.getConversationById.mockResolvedValue(null)

    const response = await POST(sendByConversation({ reply: "hola" }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "conversation not found",
    })
    expect(mocks.sendMetaMessage).not.toHaveBeenCalled()
  })
})
