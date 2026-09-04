import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
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
  resolveWhatsappAccess: vi.fn(),
  sendWhatsappOutboundMessage: vi.fn(),
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
  getActivePageWithTokenForTenant: mocks.getActivePageWithTokenForTenant,
  markPageTokenInvalid: mocks.markPageTokenInvalid,
}))

// **El espía que sostiene el gate de la ventana.** Sólo se mockea el envío: si
// el gate se cayera, este mock es el que lo delata. Los helpers puros —el
// límite de texto, el extractor del wamid, el catálogo de errores— se dejan
// reales para no falsear ni el largo ni la traducción.
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

const attachment = { type: "image", url: "https://cdn.example.com/foto.png" }

const sendRequest = (
  body: Record<string, unknown> = { reply: "hola" },
  headers: Record<string, string> = {}
) =>
  new Request("https://resender.test/api/meta/whatsapp/send", {
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

describe("POST /api/meta/whatsapp/send", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.authenticateApiKey.mockResolvedValue({ tenantId: "tenant-1" })
    mocks.resolveWhatsappAccess.mockResolvedValue(true)
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue({
      block: null,
      periodStart: new Date("2026-08-01"),
    })
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue(null)
    mocks.getActivePageWithTokenForTenant.mockResolvedValue({
      page: {
        id: "conn-1",
        tenantId: "tenant-1",
        channel: "whatsapp",
        metaPageId: "phone-1",
        username: null,
      },
      pageAccessToken: "waba-token-1",
    })
    mocks.upsertConversation.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: OPEN,
    })
    mocks.getConversationById.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: OPEN,
    })
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

  // ---- 1 ----------------------------------------------------------------
  it("rejects a request without a valid API key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- 2 ----------------------------------------------------------------
  // La cabecera es **obligatoria** en este canal: el duplicado le llega al
  // teléfono de un cliente, no a una pestaña.
  it("requires an Idempotency-Key", async () => {
    const response = await POST(
      new Request("https://resender.test/api/meta/whatsapp/send", {
        method: "POST",
        headers: { authorization: "Bearer rk_test" },
        body: JSON.stringify({ pageId: "phone-1", recipientId: "549110" }),
      }) as unknown as NextRequest
    )

    expect(response.status).toBe(400)
    expect(mocks.resolveWhatsappAccess).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("rejects an Idempotency-Key longer than 200 characters", async () => {
    const response = await POST(
      sendRequest({ reply: "hola" }, { "idempotency-key": "k".repeat(201) })
    )

    expect(response.status).toBe(400)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- 3 ----------------------------------------------------------------
  // El código es genérico a propósito —lo escribimos así anticipando este
  // canal—; el `message` es el que nombra a WhatsApp.
  it("blocks a tenant without the WhatsApp channel enabled", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "channel_not_enabled",
      message: "whatsapp channel is not enabled",
    })
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // El replay contesta 200 sin tocar Meta: si el gate quedara detrás, a un
  // tenant al que se le revocó el permiso le seguiría llegando el resultado
  // guardado como si nada.
  it("blocks the channel before serving an idempotent replay", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue({
      id: "msg-old",
      conversationId: "conv-1",
      status: "sent",
      error: null,
      providerResponse: {},
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    expect(mocks.getOutboundMessageByIdempotencyKey).not.toHaveBeenCalled()
  })

  // ---- 4 ----------------------------------------------------------------
  it("blocks a restricted tenant before calling Meta", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: { code: "quota_exceeded", status: 402, message: "sin cuota" },
      periodStart: new Date("2026-08-01"),
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(402)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("blocks a tenant without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "no active subscription",
    })
  })

  // ---- 5 ----------------------------------------------------------------
  it("replays a stored send without calling Meta", async () => {
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue({
      id: "msg-old",
      conversationId: "conv-1",
      status: "sent",
      error: null,
      providerResponse: { messages: [{ id: "wamid.old" }] },
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.resender.idempotentReplay).toBe(true)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
    expect(mocks.insertOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- 6 ----------------------------------------------------------------
  it("404s when the number is not connected for this tenant", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(404)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // El canal va explícito en la búsqueda: `meta_page_id` es único por
  // `(channel, meta_page_id)` y sin canal podría traer la fila de Messenger.
  it("looks the number up on the whatsapp channel", async () => {
    await POST(sendRequest())

    expect(mocks.getActivePageWithTokenForTenant).toHaveBeenCalledWith(
      "tenant-1",
      "phone-1",
      "whatsapp"
    )
  })

  // ---- 7 ----------------------------------------------------------------
  it("400s when conversationId does not match pageId and recipientId", async () => {
    mocks.getConversationById.mockResolvedValue({
      id: "conv-9",
      connectedPageId: "otra-conn",
      contactId: "5491100000000",
      lastInboundAt: OPEN,
    })

    const response = await POST(
      sendRequest({ reply: "hola", conversationId: "conv-9" })
    )

    expect(response.status).toBe(400)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- 8: el gate de la ventana ------------------------------------------
  // **El test que sostiene el diseño entero.** Con la ventana cerrada Meta no
  // se toca: ni una llamada, ni una fila persistida, ni cuota consumida.
  it("409s with the closed window and never calls Meta", async () => {
    mocks.getConversationById.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: CLOSED,
    })

    const response = await POST(
      sendRequest({ reply: "hola", conversationId: "conv-1" })
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe("customer_service_window_closed")
    expect(body.requiresTemplate).toBe(true)
    expect(body.templateSendingSupported).toBe(false)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
    expect(mocks.insertOutboundMessage).not.toHaveBeenCalled()
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
  })

  // Un contacto nuevo no tiene entrante: la conversación nace con
  // `last_inbound_at` null y no se le puede escribir primero sin plantilla.
  it("409s on a brand new conversation with no inbound", async () => {
    mocks.upsertConversation.mockResolvedValue({
      id: "conv-nueva",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: null,
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(409)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // El borde exacto: a las 24 h clavadas ya está cerrada.
  it("closes the window exactly 24 hours after the last inbound", async () => {
    mocks.upsertConversation.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(409)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("sends when the window is one second from closing", async () => {
    mocks.upsertConversation.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: new Date(NOW.getTime() - (24 * 60 * 60 * 1000 - 1000)),
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledTimes(1)
  })

  // La ventana manda sobre el contenido: arreglar la URL no le sirve de nada al
  // cliente hasta que el contacto escriba, así que el 409 gana al 400.
  it("reports the closed window before a malformed attachment", async () => {
    mocks.upsertConversation.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: CLOSED,
    })

    const response = await POST(
      sendRequest({
        attachment: { type: "image", url: "http://inseguro.test/f.png" },
      })
    )

    expect(response.status).toBe(409)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- 9 ----------------------------------------------------------------
  it("rejects an attachment URL that is not https", async () => {
    const response = await POST(
      sendRequest({
        attachment: { type: "image", url: "http://inseguro.test/f.png" },
      })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("attachment_url_invalid")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("rejects an unknown attachment type", async () => {
    const response = await POST(
      sendRequest({ attachment: { type: "hologram", url: "https://x.test/f" } })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("attachment_type_invalid")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("rejects reply and attachment together", async () => {
    const response = await POST(sendRequest({ reply: "hola", attachment }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("send_target_conflict")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // Cloud API cuenta 4096 **caracteres** para el body del texto.
  it("rejects a reply longer than the WhatsApp limit", async () => {
    const response = await POST(sendRequest({ reply: "a".repeat(4097) }))

    expect(response.status).toBe(400)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- camino feliz -------------------------------------------------------
  it("sends text, stores the wamid and marks the origin", async () => {
    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "waba-token-1",
        phoneNumberId: "phone-1",
        to: "5491100000000",
        content: { reply: "hola", attachment: null },
      })
    )
    // El wamid sale de `messages[0].id`: con el extractor de Messenger sería
    // null y los `statuses` posteriores no encontrarían la fila.
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metaMessageId: "wamid.HBg1",
        origin: "resender_api",
        status: "sent",
        text: "hola",
        idempotencyKey: "key-1",
      })
    )
    expect(mocks.incrementUsage).toHaveBeenCalledTimes(1)
  })

  it("sends an attachment by URL and persists it", async () => {
    const response = await POST(sendRequest({ attachment }))

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: { reply: null, attachment } })
    )
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "", attachment, origin: "resender_api" })
    )
  })

  // Se persiste también el rechazo: el fallo es historial, y es lo que el
  // usuario necesita ver cuando pregunta por qué no llegó nada.
  it("persists a Meta rejection and does not consume quota", async () => {
    mocks.sendWhatsappOutboundMessage.mockResolvedValue({
      ok: false,
      status: 400,
      data: { error: { message: "boom", code: 131053 } },
      error: "boom",
      reason: "Meta couldn't download the media from its URL.",
      code: "attachment_fetch_failed",
    })

    const response = await POST(sendRequest({ attachment }))

    expect(response.status).toBe(400)
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", origin: "resender_api" })
    )
    const body = await response.json()
    expect(body.code).toBe("attachment_fetch_failed")
    expect(body.resender.status).toBe("failed")
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
  })

  // Token vencido: se marca la conexión para que la consola pida reconectar.
  it("marks the token invalid when Meta answers 190", async () => {
    mocks.sendWhatsappOutboundMessage.mockResolvedValue({
      ok: false,
      status: 401,
      data: { error: { message: "expired", code: 190 } },
      error: "expired",
      reason: "token",
      code: null,
    })

    await POST(sendRequest())

    expect(mocks.markPageTokenInvalid).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", connectionId: "conn-1" })
    )
  })

  // Carrera de dos requests con la misma clave: el índice único rechaza el
  // segundo insert y se devuelve el mensaje ya almacenado.
  it("serves the stored message when the unique index rejects the insert", async () => {
    mocks.insertOutboundMessage.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" })
    )
    mocks.getOutboundMessageByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "msg-ganador",
        conversationId: "conv-1",
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
})
