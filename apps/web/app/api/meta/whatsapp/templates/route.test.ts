import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  createWhatsappTemplateInGraph: vi.fn(),
  createWhatsappTemplateMirror: vi.fn(),
  getActivePageWithTokenForTenant: vi.fn(),
  hasActiveSubscription: vi.fn(),
  isUserWaitlisted: vi.fn(),
  listWhatsappTemplates: vi.fn(),
  listWhatsappTemplatesInGraph: vi.fn(),
  log: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
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

vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActivePageWithTokenForTenant: mocks.getActivePageWithTokenForTenant,
}))

// El listado de Graph está mockeado **sólo para poder afirmar que nadie lo
// llama**: el `GET` lee del espejo, y ese espía es lo que hace que un futuro
// «lo traigo fresco de Meta» no pase silencioso.
vi.mock("@/lib/meta/whatsapp-template-client", () => ({
  createWhatsappTemplateInGraph: mocks.createWhatsappTemplateInGraph,
  deleteWhatsappTemplateInGraph: vi.fn(),
  listWhatsappTemplatesInGraph: mocks.listWhatsappTemplatesInGraph,
  updateWhatsappTemplateInGraph: vi.fn(),
}))

vi.mock(
  "@/lib/whatsapp-templates/template-registry",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/whatsapp-templates/template-registry")
    >()),
    createWhatsappTemplateMirror: mocks.createWhatsappTemplateMirror,
    listWhatsappTemplates: mocks.listWhatsappTemplates,
  })
)

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import type { NextRequest } from "next/server"

import { GET, POST } from "./route"

const NOW = new Date("2026-08-28T10:00:00.000Z")

const connectedNumber = {
  page: {
    id: "conn-1",
    tenantId: "tenant-1",
    channel: "whatsapp" as const,
    metaPageId: "phone-1",
    wabaId: "waba-1",
  },
  pageAccessToken: "token-1",
}

const mirrorRow = (overrides: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  wabaId: "waba-1",
  name: "order_update",
  language: "es",
  metaTemplateId: "hsm-1",
  category: "utility" as const,
  status: "APPROVED" as const,
  rawStatus: "APPROVED",
  createdByTenantId: "tenant-1",
  syncedAt: NOW,
  createdAt: NOW,
  ...overrides,
})

const listRequest = (query = "?pageId=phone-1", headers?: HeadersInit) =>
  new Request(`https://resender.test/api/meta/whatsapp/templates${query}`, {
    headers: headers ?? { authorization: "Bearer rk_test" },
  }) as unknown as NextRequest

const createRequest = (
  body: Record<string, unknown> = {},
  headers?: HeadersInit
) =>
  new Request("https://resender.test/api/meta/whatsapp/templates", {
    method: "POST",
    headers: headers ?? { authorization: "Bearer rk_test" },
    body: JSON.stringify({
      pageId: "phone-1",
      name: "order_update",
      language: "es",
      category: "utility",
      components: [{ type: "BODY", text: "Your order shipped." }],
      ...body,
    }),
  }) as unknown as NextRequest

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.authenticateApiKey.mockResolvedValue({
    id: "key-1",
    tenantId: "tenant-1",
  })
  mocks.resolveWhatsappAccess.mockResolvedValue(true)
  mocks.isUserWaitlisted.mockResolvedValue(false)
  mocks.hasActiveSubscription.mockResolvedValue(true)
  mocks.getActivePageWithTokenForTenant.mockResolvedValue(connectedNumber)
  mocks.listWhatsappTemplates.mockResolvedValue([])
})

describe("GET /api/meta/whatsapp/templates — gates", () => {
  // Los cuatro gates son los del envío **menos los de mensajería**: no hay
  // Idempotency-Key, ni cuota, ni conversación, ni ventana de atención, porque
  // acá no se le manda nada a nadie. La suscripción sí, porque administrar el
  // catálogo deja efectos permanentes en la WABA del cliente.
  it("rejects a request without an API key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await GET(listRequest("?pageId=phone-1", {}))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
    })
    expect(mocks.listWhatsappTemplates).not.toHaveBeenCalled()
  })

  it("rejects a tenant without the WhatsApp channel", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const response = await GET(listRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "channel_not_enabled",
    })
  })

  it("rejects a waitlisted account", async () => {
    mocks.isUserWaitlisted.mockResolvedValue(true)

    const response = await GET(listRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "waitlisted",
    })
  })

  it("rejects an account without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const response = await GET(listRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "no_active_subscription",
    })
    expect(mocks.listWhatsappTemplates).not.toHaveBeenCalled()
  })
})

describe("GET /api/meta/whatsapp/templates", () => {
  it("lists from the mirror and never calls Graph", async () => {
    mocks.listWhatsappTemplates.mockResolvedValue([
      mirrorRow(),
      mirrorRow({ id: "tpl-2", name: "imported", createdByTenantId: null }),
    ])

    const response = await GET(listRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.templates).toHaveLength(2)
    expect(payload.templates.map((t: { own: boolean }) => t.own)).toEqual([
      true,
      false,
    ])
    // La regla entera de esta ruta: listar no envía nada, así que el espejo
    // alcanza y pedirle el catálogo a Meta en cada pintada gastaría rate limit
    // del cliente en cada recarga.
    expect(mocks.listWhatsappTemplatesInGraph).not.toHaveBeenCalled()
  })

  it("resolves the WABA server-side and never returns it", async () => {
    mocks.listWhatsappTemplates.mockResolvedValue([mirrorRow()])

    const payload = await (await GET(listRequest())).json()

    expect(mocks.listWhatsappTemplates).toHaveBeenCalledWith({
      wabaId: "waba-1",
    })
    expect(payload).not.toHaveProperty("wabaId")
  })

  it("requires a pageId", async () => {
    const response = await GET(listRequest(""))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
  })

  it("returns 404 when the number is not connected for this tenant", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(null)

    const response = await GET(listRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "page_not_connected",
    })
  })
})

describe("POST /api/meta/whatsapp/templates", () => {
  it("creates the template in Meta and mirrors the row with its owner", async () => {
    mocks.createWhatsappTemplateInGraph.mockResolvedValue({
      ok: true,
      id: "hsm-9",
      status: "PENDING",
      category: "utility",
    })
    mocks.createWhatsappTemplateMirror.mockResolvedValue(
      mirrorRow({
        id: "tpl-9",
        metaTemplateId: "hsm-9",
        status: "PENDING",
        rawStatus: "PENDING",
      })
    )

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(mocks.createWhatsappTemplateInGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "token-1",
        wabaId: "waba-1",
        name: "order_update",
        language: "es",
        category: "utility",
        components: [{ type: "BODY", text: "Your order shipped." }],
      })
    )
    expect(mocks.createWhatsappTemplateMirror).toHaveBeenCalledWith(
      expect.objectContaining({ createdByTenantId: "tenant-1" })
    )
    expect(payload).toMatchObject({
      mirrored: true,
      template: { id: "tpl-9", own: true, status: "PENDING" },
    })
  })

  it("does not mirror the row when Meta rejects the template", async () => {
    mocks.createWhatsappTemplateInGraph.mockResolvedValue({
      ok: false,
      status: 400,
      metaErrorCode: 132000,
      error: "raw meta text",
      reason: "That template name is already used in this account.",
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "template_create_failed",
      message: "That template name is already used in this account.",
    })
    expect(mocks.createWhatsappTemplateMirror).not.toHaveBeenCalled()
  })

  it("rejects a body whose variables have no example values", async () => {
    const response = await POST(
      createRequest({
        components: [{ type: "BODY", text: "Hi {{1}}, your order shipped." }],
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "missing_variable_examples",
    })
    expect(mocks.createWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })

  it("rejects the authentication category before reaching Meta", async () => {
    const response = await POST(createRequest({ category: "authentication" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_template_category",
    })
    expect(mocks.createWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })

  it("does not touch Meta for an account without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(mocks.createWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })
})
