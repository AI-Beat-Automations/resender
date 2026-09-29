import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente de WhatsApp lee las credenciales al importarse.
vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "meta-app-id")
vi.stubEnv("META_APP_SECRET", "meta-app-secret")

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getActiveWhatsappNumberWithTokenForActor: vi.fn(),
  getActiveWhatsappWabaIdForTenant: vi.fn(),
  insertOwnedWhatsappTemplate: vi.fn(),
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
  getActiveWhatsappNumberWithTokenForActor:
    mocks.getActiveWhatsappNumberWithTokenForActor,
  getActiveWhatsappWabaIdForTenant: mocks.getActiveWhatsappWabaIdForTenant,
}))

// `isOwnedByParent` y la normalización se dejan reales: `own` es parte de lo
// que se prueba.
vi.mock("@/lib/whatsapp-templates/template-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/whatsapp-templates/template-store")
  >()),
  insertOwnedWhatsappTemplate: mocks.insertOwnedWhatsappTemplate,
  listWhatsappTemplatesForWaba: mocks.listWhatsappTemplatesForWaba,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

const { NextRequest } = await import("next/server")
const { META_GRAPH_VERSION } = await import("@/lib/meta/graph-version")
const { GET, POST } = await import("./route")

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

describe("POST /api/meta/whatsapp/templates", () => {
  const fetchMock = vi.fn<typeof fetch>()

  const createRequest = (body: unknown) =>
    new NextRequest("https://resender.test/api/meta/whatsapp/templates", {
      method: "POST",
      headers: {
        authorization: "Bearer rk_test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })

  const createBody = (overrides: Record<string, unknown> = {}) => ({
    pageId: "phone-1",
    name: "aviso_de_cita",
    language: "es_MX",
    category: "utility",
    body: { text: "Hola {{1}}, tu cita es mañana.", examples: ["Ana"] },
    ...overrides,
  })

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
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
    mocks.getActiveWhatsappNumberWithTokenForActor.mockResolvedValue({
      page: { id: "conn-1", metaPageId: "phone-1", channel: "whatsapp" },
      wabaId: "waba-1",
      pageAccessToken: "token-1",
    })
    mocks.insertOwnedWhatsappTemplate.mockImplementation(
      async (input: Record<string, unknown>) =>
        record({
          id: "tpl-new",
          name: input.name,
          language: input.language,
          metaTemplateId: input.metaTemplateId,
          status: input.status,
          body: input.body,
          createdByTenantId: input.createdByTenantId,
          createdByClientAccountId: input.createdByClientAccountId,
        })
    )
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "hsm-new",
          status: "PENDING",
          category: "UTILITY",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("crea en Meta y guarda la fila del padre con hsm id y estado", async () => {
    const response = await POST(
      createRequest(createBody({ footer: "Clínica" }))
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      template: {
        id: "tpl-new",
        name: "aviso_de_cita",
        language: "es_MX",
        category: "utility",
        status: "PENDING",
        body: "Hola {{1}}, tu cita es mañana.",
        own: true,
      },
    })

    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/waba-1/message_templates`
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "aviso_de_cita",
      language: "es_MX",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Hola {{1}}, tu cita es mañana.",
          example: { body_text: [["Ana"]] },
        },
        { type: "FOOTER", text: "Clínica" },
      ],
    })
    expect(mocks.insertOwnedWhatsappTemplate).toHaveBeenCalledWith({
      wabaId: "waba-1",
      name: "aviso_de_cita",
      language: "es_MX",
      metaTemplateId: "hsm-new",
      category: "utility",
      status: "PENDING",
      body: "Hola {{1}}, tu cita es mañana.",
      createdByTenantId: "tenant-1",
      createdByClientAccountId: null,
    })
  })

  it("400 sin ejemplo para una variable, sin llamar a Meta", async () => {
    const response = await POST(
      createRequest(createBody({ body: { text: "Hola {{1}}, ¿vienes?" } }))
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: "template_examples_mismatch",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("400 con una categoría fuera del editor v1", async () => {
    const response = await POST(
      createRequest(createBody({ category: "authentication" }))
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: "template_category_invalid",
    })
  })

  it("400 sin pageId", async () => {
    const response = await POST(createRequest(createBody({ pageId: "" })))

    expect(response.status).toBe(400)
  })

  it("404 si el número no es del tenant", async () => {
    mocks.getActiveWhatsappNumberWithTokenForActor.mockResolvedValue(null)

    const response = await POST(createRequest(createBody()))

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("el rechazo de Meta no guarda fila", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 100,
            error_subcode: 2388024,
            message: "Invalid parameter",
            error_user_msg: "Content in this language already exists",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    )

    const response = await POST(createRequest(createBody()))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: "Content in this language already exists",
      meta: { code: 100, subcode: 2388024 },
    })
    expect(mocks.insertOwnedWhatsappTemplate).not.toHaveBeenCalled()
  })

  it("el Plan Free pasa y no pide Idempotency-Key", async () => {
    const response = await POST(createRequest(createBody()))

    expect(response.status).toBe(201)
    expect(mocks.getTenantEntitlement).toHaveBeenCalledWith("tenant-1")
  })

  it("rechaza una cuenta restringida", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: { code: "quota_exceeded", message: "x", status: 402 },
      periodStart: new Date("2026-08-01"),
    })

    const response = await POST(createRequest(createBody()))

    expect(response.status).toBe(402)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
