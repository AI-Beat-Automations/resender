import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  deleteConversationIfEmpty: vi.fn(),
  getConversationByContact: vi.fn(),
  getActivePageWithTokenByConnectionId: vi.fn(),
  getActivePageWithTokenForTenant: vi.fn(),
  getConversationById: vi.fn(),
  getOutboundMessageByIdempotencyKey: vi.fn(),
  getTenantEntitlement: vi.fn(),
  incrementUsage: vi.fn(),
  insertOutboundMessage: vi.fn(),
  isUserWaitlisted: vi.fn(),
  log: vi.fn(),
  markPageTokenInvalid: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
  sendWhatsappOutboundMessage: vi.fn(),
  updateConversationContactId: vi.fn(),
  upsertConversation: vi.fn(),
}))

vi.mock("@/lib/auth/api-keys", () => ({
  authenticateApiKey: mocks.authenticateApiKey,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveWhatsappAccess: mocks.resolveWhatsappAccess,
}))

vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))

vi.mock("@/lib/billing/entitlement-status", () => ({
  getTenantEntitlement: mocks.getTenantEntitlement,
}))

vi.mock("@/lib/billing/usage-counter", () => ({
  incrementUsage: mocks.incrementUsage,
}))

vi.mock("@/lib/messages/message-log", () => ({
  deleteConversationIfEmpty: mocks.deleteConversationIfEmpty,
  getConversationByContact: mocks.getConversationByContact,
  getConversationById: mocks.getConversationById,
  getOutboundMessageByIdempotencyKey: mocks.getOutboundMessageByIdempotencyKey,
  insertOutboundMessage: mocks.insertOutboundMessage,
  updateConversationContactId: mocks.updateConversationContactId,
  upsertConversation: mocks.upsertConversation,
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActivePageWithTokenByConnectionId:
    mocks.getActivePageWithTokenByConnectionId,
  getActivePageWithTokenForTenant: mocks.getActivePageWithTokenForTenant,
  markPageTokenInvalid: mocks.markPageTokenInvalid,
}))

// Sólo se mockea el envío. Los helpers puros —el extractor del wamid y del
// `wa_id`, el catálogo de errores— se dejan reales.
vi.mock("@/lib/outbound/whatsapp-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outbound/whatsapp-send")>()),
  sendWhatsappOutboundMessage: mocks.sendWhatsappOutboundMessage,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null, captureDeferred: vi.fn() }))

import type { NextRequest } from "next/server"

import { POST } from "./route"

const NOW = new Date("2026-08-24T12:00:00.000Z")
const OPEN = new Date("2026-08-24T11:00:00.000Z")
const CLOSED = new Date("2026-08-23T11:00:00.000Z")

const hello = { name: "hello_world", language: "en_US" }

const sendRequest = (
  body: Record<string, unknown> = { template: hello },
  headers: Record<string, string> = {}
) =>
  new Request("https://resender.test/api/meta/whatsapp/templates/send", {
    method: "POST",
    headers: {
      authorization: "Bearer rk_test",
      "idempotency-key": "key-1",
      ...headers,
    },
    body: JSON.stringify({
      pageId: "phone-1",
      recipientId: "5491100000000",
      ...body,
    }),
  }) as unknown as NextRequest

const conversation = (lastInboundAt: Date | null) => ({
  id: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
  connectedPageId: "conn-1",
  contactId: "5491100000000",
  lastInboundAt,
})

describe("POST /api/meta/whatsapp/templates/send", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.authenticateApiKey.mockResolvedValue({ tenantId: "tenant-1" })
    mocks.resolveWhatsappAccess.mockResolvedValue(true)
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.getTenantEntitlement.mockResolvedValue({
      block: null,
      periodStart: new Date("2026-08-01"),
    })
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue(null)
    const connection = {
      page: {
        id: "conn-1",
        tenantId: "tenant-1",
        channel: "whatsapp",
        metaPageId: "phone-1",
        username: null,
      },
      pageAccessToken: "waba-token-1",
    }
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(connection)
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(connection)
    // Por defecto, un contacto que nunca escribió: es el caso de la plantilla.
    mocks.upsertConversation.mockResolvedValue(conversation(null))
    mocks.getConversationById.mockResolvedValue(conversation(null))
    mocks.insertOutboundMessage.mockImplementation(
      async (input: { conversationId: string; status: string }) => ({
        id: "msg-1",
        conversationId: input.conversationId,
        status: input.status,
      })
    )
    mocks.sendWhatsappOutboundMessage.mockResolvedValue({
      ok: true,
      status: 200,
      data: { messages: [{ id: "wamid.HBg1" }] },
      error: null,
      reason: null,
      code: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---- gates, en orden --------------------------------------------------
  it("rejects a request without a valid API key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(401)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("requires an Idempotency-Key", async () => {
    const response = await POST(
      new Request("https://resender.test/api/meta/whatsapp/templates/send", {
        method: "POST",
        headers: { authorization: "Bearer rk_test" },
        body: JSON.stringify({
          pageId: "phone-1",
          recipientId: "549110",
          template: hello,
        }),
      }) as unknown as NextRequest
    )

    expect(response.status).toBe(400)
    expect(mocks.resolveWhatsappAccess).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("blocks a tenant without the WhatsApp channel before the replay", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    expect(mocks.getOutboundMessageByIdempotencyKey).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("blocks a waitlisted account", async () => {
    mocks.isUserWaitlisted.mockResolvedValue(true)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    expect(mocks.getTenantEntitlement).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("blocks a restricted tenant before calling Meta", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: { code: "quota_exceeded", status: 402, message: "sin cuota" },
      periodStart: new Date("2026-08-01"),
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(402)
    expect(mocks.getOutboundMessageByIdempotencyKey).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("replays a stored send without calling Meta", async () => {
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue({
      id: "msg-old",
      conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      status: "sent",
      error: null,
      providerResponse: { messages: [{ id: "wamid.old" }] },
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.resender).toEqual({
      conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      messageId: "msg-old",
      status: "sent",
      idempotentReplay: true,
    })
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
    expect(mocks.insertOutboundMessage).not.toHaveBeenCalled()
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
  })

  // ---- body ---------------------------------------------------------------
  it("400s a body with no destination", async () => {
    const response = await POST(
      new Request("https://resender.test/api/meta/whatsapp/templates/send", {
        method: "POST",
        headers: { authorization: "Bearer rk_test", "idempotency-key": "k" },
        body: JSON.stringify({ template: hello }),
      }) as unknown as NextRequest
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("send_destination_missing")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("400s a template without language", async () => {
    const response = await POST(
      sendRequest({ template: { name: "hello_world" } })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("template_language_missing")
    expect(mocks.getActivePageWithTokenForTenant).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // Un cuerpo de texto no es una plantilla: esta ruta no cae en `/send`.
  it("400s a text reply sent to the template route", async () => {
    const response = await POST(sendRequest({ reply: "hola" }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("template_missing")
  })

  it("404s when the number is not connected for this tenant", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(404)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- la ventana no aplica ----------------------------------------------
  // **El test que distingue esta ruta de `/send`.** Ventana cerrada, o un
  // contacto que nunca escribió: la plantilla sale igual.
  it("sends with the customer service window closed", async () => {
    mocks.upsertConversation.mockResolvedValue(conversation(CLOSED))

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledTimes(1)
  })

  it("sends to a contact that never wrote", async () => {
    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledTimes(1)
  })

  it("also sends with the window open", async () => {
    mocks.upsertConversation.mockResolvedValue(conversation(OPEN))

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
  })

  // ---- camino feliz -------------------------------------------------------
  it("sends the template, persists it and consumes quota", async () => {
    const components = [
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]
    const template = { name: "pedido_listo", language: "es_AR", components }

    const response = await POST(sendRequest({ template }))

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledWith({
      accessToken: "waba-token-1",
      phoneNumberId: "phone-1",
      to: "5491100000000",
      content: { template },
    })
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        attachment: null,
        templateMeta: template,
        origin: "resender_api",
        status: "sent",
        metaMessageId: "wamid.HBg1",
        idempotencyKey: "key-1",
      })
    )
    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "tenant-1",
      new Date("2026-08-01")
    )
    await expect(response.json()).resolves.toEqual({
      meta: { messages: [{ id: "wamid.HBg1" }] },
      resender: {
        conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
        messageId: "msg-1",
        status: "sent",
      },
    })
  })

  it("sends with conversationId alone", async () => {
    const response = await POST(
      new Request("https://resender.test/api/meta/whatsapp/templates/send", {
        method: "POST",
        headers: { authorization: "Bearer rk_test", "idempotency-key": "k" },
        body: JSON.stringify({
          conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
          template: hello,
        }),
      }) as unknown as NextRequest
    )

    expect(response.status).toBe(200)
    expect(mocks.upsertConversation).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: "5491100000000" })
    )
  })

  // El nombre sí se loguea; los `components` no, porque traen datos del
  // cliente final.
  it("logs the template name but never its components", async () => {
    await POST(
      sendRequest({
        template: {
          ...hello,
          components: [
            { type: "body", parameters: [{ type: "text", text: "secreto" }] },
          ],
        },
      })
    )

    const terminal = mocks.log.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.action === "template_send")
    expect(terminal).toMatchObject({
      outcome: "ok",
      templateName: "hello_world",
    })
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("secreto")
  })

  // ---- fallos -------------------------------------------------------------
  it("persists a Meta rejection with the same shape and no quota", async () => {
    mocks.sendWhatsappOutboundMessage.mockResolvedValue({
      ok: false,
      status: 400,
      data: {
        error: { message: "Template name does not exist", code: 132001 },
      },
      error: "Template name does not exist",
      reason: null,
      code: null,
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(400)
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        templateMeta: hello,
        metaMessageId: null,
      })
    )
    const body = await response.json()
    expect(body.error).toBe("Template name does not exist")
    expect(body.resender).toEqual({
      conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
      messageId: "msg-1",
      status: "failed",
    })
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
  })

  it("marks the token invalid when Meta answers 190", async () => {
    mocks.sendWhatsappOutboundMessage.mockResolvedValue({
      ok: false,
      status: 401,
      data: { error: { message: "expired", code: 190 } },
      error: "expired",
      reason: null,
      code: null,
    })

    await POST(sendRequest())

    expect(mocks.markPageTokenInvalid).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", connectionId: "conn-1" })
    )
  })

  it("serves the stored message when the unique index rejects the insert", async () => {
    mocks.insertOutboundMessage.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" })
    )
    mocks.getOutboundMessageByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "msg-ganador",
        conversationId: "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
        status: "sent",
        error: null,
        providerResponse: {},
      })

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.resender.messageId).toBe("msg-ganador")
    expect(body.resender.idempotentReplay).toBe(true)
  })

  // ---- wa_id (ADR 0024) -------------------------------------------------
  it("stores the template in the wa_id conversation Meta answered with", async () => {
    const dialed = { ...conversation(null), contactId: "525512345678" }
    mocks.upsertConversation.mockResolvedValue(dialed)
    mocks.getConversationByContact.mockResolvedValue(null)
    mocks.updateConversationContactId.mockResolvedValue({
      ...dialed,
      contactId: "5215512345678",
    })
    mocks.sendWhatsappOutboundMessage.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        messaging_product: "whatsapp",
        contacts: [{ input: "525512345678", wa_id: "5215512345678" }],
        messages: [{ id: "wamid.HBg1" }],
      },
      error: null,
      reason: null,
      code: null,
    })

    const response = await POST(
      sendRequest({ template: hello, recipientId: "525512345678" })
    )

    expect(response.status).toBe(200)
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "5215512345678" })
    )
  })
})
