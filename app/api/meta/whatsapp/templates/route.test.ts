import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getActiveWhatsappWabaIdForTenant: vi.fn(),
  getTenantEntitlement: vi.fn(),
  isUserWaitlisted: vi.fn(),
  listWhatsappTemplatesForWaba: vi.fn(),
  log: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
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

vi.mock("@/lib/messages/message-log", () => ({
  getOutboundMessageByIdempotencyKey: vi.fn(),
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActiveWhatsappWabaIdForTenant: mocks.getActiveWhatsappWabaIdForTenant,
}))

// `isOwnedByParent` y la normalización se dejan reales: `own` es parte de lo
// que se prueba.
vi.mock("@/lib/whatsapp-templates/template-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/whatsapp-templates/template-store")
  >()),
  listWhatsappTemplatesForWaba: mocks.listWhatsappTemplatesForWaba,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import { NextRequest } from "next/server"

import { GET } from "./route"

const listRequest = (
  query = "?pageId=phone-1",
  headers: Record<string, string> = { authorization: "Bearer rk_test" }
) =>
  new NextRequest(`https://resender.test/api/meta/whatsapp/templates${query}`, {
    method: "GET",
    headers,
  })

const record = (overrides: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  wabaId: "waba-1",
  name: "hello_world",
  language: "en_US",
  metaTemplateId: "hsm-1",
  category: "utility",
  status: "APPROVED",
  body: "Hello World",
  createdByTenantId: null,
  createdByClientAccountId: null,
  syncedAt: new Date(),
  createdAt: new Date(),
  ...overrides,
})

describe("GET /api/meta/whatsapp/templates", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.authenticateApiKey.mockResolvedValue({
      id: "key-1",
      tenantId: "tenant-1",
    })
    mocks.resolveWhatsappAccess.mockResolvedValue(true)
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.getTenantEntitlement.mockResolvedValue({
      block: null,
      periodStart: new Date("2026-08-01"),
    })
    mocks.getActiveWhatsappWabaIdForTenant.mockResolvedValue({
      connectionId: "conn-1",
      wabaId: "waba-1",
    })
    mocks.listWhatsappTemplatesForWaba.mockResolvedValue([])
  })

  it("lista el catálogo de la WABA del número, con `own` del padre", async () => {
    mocks.listWhatsappTemplatesForWaba.mockResolvedValue([
      // Del sync: sin dueño.
      record(),
      // Creada por el padre.
      record({
        id: "tpl-2",
        name: "propia",
        status: "PENDING",
        body: null,
        createdByTenantId: "tenant-1",
      }),
      // Creada por un cliente del padre: no es del padre.
      record({
        id: "tpl-3",
        name: "del_cliente",
        createdByTenantId: "tenant-1",
        createdByClientAccountId: "client-1",
      }),
      // De otro tenant que comparte la WABA.
      record({ id: "tpl-4", name: "ajena", createdByTenantId: "tenant-2" }),
    ])

    const response = await GET(listRequest())

    expect(response.status).toBe(200)
    expect(mocks.getActiveWhatsappWabaIdForTenant).toHaveBeenCalledWith(
      "tenant-1",
      "phone-1"
    )
    expect(mocks.listWhatsappTemplatesForWaba).toHaveBeenCalledWith("waba-1")
    const json = (await response.json()) as {
      templates: Record<string, unknown>[]
    }
    expect(json.templates[0]).toEqual({
      id: "tpl-1",
      name: "hello_world",
      language: "en_US",
      category: "utility",
      status: "APPROVED",
      body: "Hello World",
      own: false,
    })
    expect(json.templates.map((t) => [t.name, t.own])).toEqual([
      ["hello_world", false],
      ["propia", true],
      ["del_cliente", false],
      ["ajena", false],
    ])
  })

  it("404 si el pageId no es un número activo del tenant", async () => {
    mocks.getActiveWhatsappWabaIdForTenant.mockResolvedValue(null)

    const response = await GET(listRequest("?pageId=phone-de-otro"))

    expect(response.status).toBe(404)
    expect(mocks.listWhatsappTemplatesForWaba).not.toHaveBeenCalled()
  })

  it("400 sin pageId", async () => {
    const response = await GET(listRequest(""))

    expect(response.status).toBe(400)
    expect(mocks.getActiveWhatsappWabaIdForTenant).not.toHaveBeenCalled()
  })

  it("rechaza una cuenta restringida con el mismo criterio que /send", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: {
        code: "quota_exceeded",
        message: "Monthly quota exceeded",
        status: 402,
      },
      periodStart: new Date("2026-08-01"),
    })

    const response = await GET(listRequest())

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({ error: "quota_exceeded" })
    expect(mocks.listWhatsappTemplatesForWaba).not.toHaveBeenCalled()
  })

  it("no pide Idempotency-Key: listar no envía nada", async () => {
    const response = await GET(listRequest())

    expect(response.status).toBe(200)
  })

  it("401 sin API key válida", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await GET(listRequest("?pageId=phone-1", {}))

    expect(response.status).toBe(401)
  })

  it("403 si el canal no está habilitado", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const response = await GET(listRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "channel_not_enabled",
    })
  })

  it("403 en waitlist", async () => {
    mocks.isUserWaitlisted.mockResolvedValue(true)

    const response = await GET(listRequest())

    expect(response.status).toBe(403)
  })
})
