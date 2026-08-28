import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getActivePageWithTokenForTenant: vi.fn(),
  getConversationById: vi.fn(),
  getOutboundMessageByIdempotencyKey: vi.fn(),
  getTenantEntitlement: vi.fn(),
  getWhatsappTemplate: vi.fn(),
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

vi.mock("@/lib/api-keys/api-keys", () => ({
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

// Sólo la **lectura** del espejo se mockea, porque es lo único que toca la
// base. La decisión —`decideWhatsappTemplateSend`— se deja real a propósito: es
// pura y es el corazón de esta ruta, y mockearla dejaría los tests del 409 y
// del fail-open verificando que sabemos escribir un `if`.
vi.mock(
  "@/lib/whatsapp-templates/template-registry",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/whatsapp-templates/template-registry")
    >()),
    getWhatsappTemplate: mocks.getWhatsappTemplate,
  })
)

// **El espía que sostiene el gate del espejo.** Sólo se mockea el envío: los
// helpers puros —el extractor del wamid, el catálogo de errores, el adaptador
// del contenido— se dejan reales para no falsear ni la forma del sobre ni la
// traducción.
vi.mock("@/lib/outbound/whatsapp-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outbound/whatsapp-send")>()),
  sendWhatsappOutboundMessage: mocks.sendWhatsappOutboundMessage,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import type { NextRequest } from "next/server"

import { POST } from "./route"

const NOW = new Date("2026-08-24T12:00:00.000Z")
// Hace 48 horas: la ventana de atención está cerrada con holgura. Es el estado
// normal del caso de uso de esta ruta, no un borde.
const TWO_DAYS_AGO = new Date("2026-08-22T12:00:00.000Z")

const template = { name: "order_update", language: "es" }

const mirroredRow = (status: string) => ({
  id: "tpl-1",
  wabaId: "waba-1",
  name: "order_update",
  language: "es",
  metaTemplateId: "hsm-1",
  category: "utility" as const,
  status,
  rawStatus: status,
  createdByTenantId: "tenant-1",
  syncedAt: NOW,
  createdAt: NOW,
})

const sendRequest = (
  body: Record<string, unknown> = { template },
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

describe("POST /api/meta/whatsapp/templates/send", () => {
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
        wabaId: "waba-1",
      },
      pageAccessToken: "waba-token-1",
    })
    // El default de toda esta suite es la ventana **cerrada**: es el caso para
    // el que existe la ruta, no una excepción.
    mocks.upsertConversation.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: TWO_DAYS_AGO,
    })
    mocks.getConversationById.mockResolvedValue({
      id: "conv-1",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: TWO_DAYS_AGO,
    })
    mocks.getWhatsappTemplate.mockResolvedValue(mirroredRow("APPROVED"))
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

  // ---- 1 a 8: los gates compartidos ---------------------------------------
  // Se verifican acá también, y no sólo en el test del helper: lo que importa
  // no es que el helper funcione sino que **esta** ruta lo consulte antes de
  // tocar Meta, y en el mismo orden.
  it("rejects a request without a valid API key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // Obligatoria, igual que en el envío libre y por el mismo motivo: el mensaje
  // le llega al teléfono de un cliente y un duplicado es una molestia real.
  it("requires an Idempotency-Key", async () => {
    const response = await POST(
      new Request("https://resender.test/api/meta/whatsapp/templates/send", {
        method: "POST",
        headers: { authorization: "Bearer rk_test" },
        body: JSON.stringify({
          pageId: "phone-1",
          recipientId: "5491100000000",
          template,
        }),
      }) as unknown as NextRequest
    )

    expect(response.status).toBe(400)
    expect(mocks.resolveWhatsappAccess).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("blocks a tenant without the WhatsApp channel enabled", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "channel_not_enabled",
      message: "whatsapp channel is not enabled",
    })
    expect(mocks.getOutboundMessageByIdempotencyKey).not.toHaveBeenCalled()
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("blocks a waitlisted tenant", async () => {
    mocks.isUserWaitlisted.mockResolvedValue(true)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "account is on the waitlist",
    })
  })

  it("blocks a tenant without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "no active subscription",
    })
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("blocks a restricted tenant before calling Meta", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: { code: "quota_exceeded", status: 402, message: "sin cuota" },
      periodStart: new Date("2026-08-01"),
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(402)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

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
    expect(mocks.getWhatsappTemplate).not.toHaveBeenCalled()
  })

  // ---- 9. El body ----------------------------------------------------------
  it("400s with a stable code when the template is missing", async () => {
    const response = await POST(sendRequest({}))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("template_missing")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("400s when the template has no language", async () => {
    const response = await POST(
      sendRequest({ template: { name: "order_update" } })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("template_language_missing")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- 10. La cuenta conectada --------------------------------------------
  it("404s when the number is not connected for this tenant", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(404)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  it("looks the number up on the whatsapp channel", async () => {
    await POST(sendRequest())

    expect(mocks.getActivePageWithTokenForTenant).toHaveBeenCalledWith(
      "tenant-1",
      "phone-1",
      "whatsapp"
    )
  })

  // ---- 11. La conversación -------------------------------------------------
  it("400s when conversationId does not match pageId and recipientId", async () => {
    mocks.getConversationById.mockResolvedValue({
      id: "conv-9",
      connectedPageId: "otra-conn",
      contactId: "5491100000000",
      lastInboundAt: TWO_DAYS_AGO,
    })

    const response = await POST(
      sendRequest({ template, conversationId: "conv-9" })
    )

    expect(response.status).toBe(400)
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // ---- La ventana de 24 h: NO se aplica ------------------------------------
  // **El test que codifica el punto entero de la entrega.** El contacto no
  // escribió en 48 horas —por `/whatsapp/send` esto sería un 409
  // `customer_service_window_closed`— y por acá el mensaje sale igual. Si
  // alguien agrega el gate de la ventana a esta ruta, este test es el que se
  // rompe, y por eso el nombre dice el caso y no la implementación.
  it("sends to a contact who has not written in 48 hours", async () => {
    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledTimes(1)
    const body = await response.json()
    expect(body.resender.status).toBe("sent")
  })

  // Un contacto que **nunca** escribió: la conversación nace sin entrante y la
  // plantilla es justamente lo que la alcanza. Es la historia de usuario 1 del
  // issue #79 y el caso que hasta esta entrega era imposible.
  it("sends to a brand new contact who never wrote at all", async () => {
    mocks.upsertConversation.mockResolvedValue({
      id: "conv-nueva",
      connectedPageId: "conn-1",
      contactId: "5491100000000",
      lastInboundAt: null,
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledTimes(1)
    const body = await response.json()
    expect(body.resender.conversationId).toBe("conv-nueva")
  })

  // ---- 12. El gate del espejo ---------------------------------------------
  it("409s with template_not_approved and never calls Meta", async () => {
    mocks.getWhatsappTemplate.mockResolvedValue(mirroredRow("REJECTED"))

    const response = await POST(sendRequest())

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe("template_not_approved")
    // El estado va nombrado en la respuesta: sin él el cliente no sabe si
    // esperar la revisión o reescribir la plantilla.
    expect(body.templateStatus).toBe("REJECTED")
    expect(body.message).toContain("order_update")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
    expect(mocks.insertOutboundMessage).not.toHaveBeenCalled()
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
  })

  // Un estado que Meta agregó y nosotros todavía no modelamos tampoco es
  // "aprobado". La respuesta devuelve el string crudo, que es la única pista
  // útil que tiene el cliente.
  it("409s on a status Resender does not recognise, reporting it raw", async () => {
    mocks.getWhatsappTemplate.mockResolvedValue(mirroredRow("FLAGGED_BY_META"))

    const response = await POST(sendRequest())

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe("template_not_approved")
    expect(body.templateStatus).toBe("FLAGGED_BY_META")
    expect(mocks.sendWhatsappOutboundMessage).not.toHaveBeenCalled()
  })

  // **El fail-open, con todas las letras.** Una plantilla que el espejo todavía
  // no conoce —creada en WhatsApp Manager después del último sync, o mientras
  // el job paginaba— **se envía igual**, y decide Meta. Rechazarla sería negarle
  // al cliente un envío válido por una carencia nuestra que él no puede
  // arreglar. Si este test se vuelve rojo, el fail-open se rompió: no lo
  // "arregles" cambiando la expectativa.
  it("sends a template that is missing from the mirror instead of rejecting it (fail-open)", async () => {
    mocks.getWhatsappTemplate.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledTimes(1)
  })

  // **El fail-open también cubre a la base.** Es el único gate del envío cuyo
  // contrato es permitir ante la duda, y un error de lectura es un hueco más:
  // sin este `try` una caída de la base contestaba 500 —el rechazo más duro de
  // todos— justo en el envío que el fail-open existe para dejar pasar, y encima
  // sin línea terminal de la request.
  it("sends the template when the mirror lookup itself fails (fail-open covers read errors)", async () => {
    mocks.getWhatsappTemplate.mockRejectedValue(
      new Error("connection terminated")
    )

    const response = await POST(sendRequest())

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledTimes(1)

    // El hueco no es silencioso: queda la línea del fallo de lectura, con la
    // acción del **envío** —esto no es un listado del catálogo, y filtrar por
    // `template_list` lo mezclaría con el CRUD— y un motivo propio que la
    // separa de la terminal: acá no falló el envío sino la consulta del gate.
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_send",
        outcome: "failed",
        reason: "template_mirror_unavailable",
        templateName: "order_update",
      })
    )
    // Y sigue habiendo **una sola** línea terminal de la request: la del
    // helper, que es la única que lleva `subject`.
    const terminals = mocks.log.mock.calls.filter(
      ([line]) =>
        (line as { action?: string }).action === "template_send" &&
        (line as { subject?: string }).subject !== undefined
    )
    expect(terminals).toHaveLength(1)
  })

  it("looks the mirror up by WABA, name and language", async () => {
    await POST(sendRequest())

    expect(mocks.getWhatsappTemplate).toHaveBeenCalledWith({
      wabaId: "waba-1",
      name: "order_update",
      language: "es",
    })
  })

  // ---- 13. El envío y su fila ---------------------------------------------
  it("sends the template, stores the wamid and marks the origin", async () => {
    const components = [
      { type: "body", parameters: [{ type: "text", text: "ARG-1" }] },
    ]

    const response = await POST(
      sendRequest({ template: { ...template, components } })
    )

    expect(response.status).toBe(200)
    expect(mocks.sendWhatsappOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "waba-token-1",
        phoneNumberId: "phone-1",
        to: "5491100000000",
        content: {
          reply: null,
          attachment: null,
          template: { name: "order_update", language: "es", components },
        },
      })
    )
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metaMessageId: "wamid.HBg1",
        origin: "resender_api",
        status: "sent",
        idempotencyKey: "key-1",
      })
    )
    expect(mocks.incrementUsage).toHaveBeenCalledTimes(1)
  })

  // La fila de un envío de plantilla: sin texto, sin adjunto, y con lo que se
  // mandó de verdad en `templateMeta`. El Inbox renderiza desde ahí, así que si
  // esto no se guarda la burbuja queda vacía.
  it("persists an empty text, no attachment and the template of this send", async () => {
    const components = [
      { type: "body", parameters: [{ type: "text", text: "ARG-1" }] },
    ]

    await POST(sendRequest({ template: { ...template, components } }))

    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        attachment: null,
        templateMeta: { name: "order_update", language: "es", components },
      })
    )
  })

  it("persists a Meta rejection and does not consume quota", async () => {
    mocks.sendWhatsappOutboundMessage.mockResolvedValue({
      ok: false,
      status: 400,
      data: { error: { message: "boom", code: 132001 } },
      error: "boom",
      reason: "That template does not exist in this WhatsApp Business Account.",
      code: "template_not_found",
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(400)
    expect(mocks.insertOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", origin: "resender_api" })
    )
    const body = await response.json()
    expect(body.code).toBe("template_not_found")
    // Mismo sobre que `/whatsapp/send`, también en el fallo.
    expect(body.resender).toEqual({
      conversationId: "conv-1",
      messageId: "msg-1",
      status: "failed",
    })
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
  })

  // La cuota se consume **sólo** si Meta aceptó, y una plantilla consume 1 como
  // cualquier otro saliente: ni más por ser plantilla ni menos.
  it("consumes exactly one unit of quota when Meta accepts", async () => {
    await POST(sendRequest())

    expect(mocks.incrementUsage).toHaveBeenCalledTimes(1)
    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "tenant-1",
      new Date("2026-08-01")
    )
  })

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
