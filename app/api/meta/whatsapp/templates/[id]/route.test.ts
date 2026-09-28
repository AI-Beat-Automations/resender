import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente de WhatsApp lee las credenciales al importarse.
vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "meta-app-id")
vi.stubEnv("META_APP_SECRET", "meta-app-secret")

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  countTemplateUsageByOtherNumbers: vi.fn(),
  deleteWhatsappTemplateById: vi.fn(),
  getActiveWhatsappNumberWithTokenForActor: vi.fn(),
  getTenantEntitlement: vi.fn(),
  getWhatsappTemplateById: vi.fn(),
  isUserWaitlisted: vi.fn(),
  log: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
  updateWhatsappTemplateContent: vi.fn(),
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
}))

// La regla de dueño y el orden de los controles son los reales: es lo que se
// prueba. Solo se reemplaza la base.
vi.mock("@/lib/whatsapp-templates/template-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/whatsapp-templates/template-store")
  >()),
  countTemplateUsageByOtherNumbers: mocks.countTemplateUsageByOtherNumbers,
  deleteWhatsappTemplateById: mocks.deleteWhatsappTemplateById,
  getWhatsappTemplateById: mocks.getWhatsappTemplateById,
  updateWhatsappTemplateContent: mocks.updateWhatsappTemplateContent,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

const { NextRequest } = await import("next/server")
const { META_GRAPH_VERSION } = await import("@/lib/meta/graph-version")
const { DELETE, PATCH } = await import("./route")

const TEMPLATE_ID = "0b6f5a4e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"

const context = (id = TEMPLATE_ID) => ({ params: Promise.resolve({ id }) })

const patchRequest = (body: unknown) =>
  new NextRequest(
    `https://resender.test/api/meta/whatsapp/templates/${TEMPLATE_ID}`,
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer rk_test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  )

const deleteRequest = (query = "?pageId=phone-1") =>
  new NextRequest(
    `https://resender.test/api/meta/whatsapp/templates/${TEMPLATE_ID}${query}`,
    { method: "DELETE", headers: { authorization: "Bearer rk_test" } }
  )

const editBody = (overrides: Record<string, unknown> = {}) => ({
  pageId: "phone-1",
  body: { text: "Hola {{1}}, nos vemos.", examples: ["Ana"] },
  ...overrides,
})

const record = (overrides: Record<string, unknown> = {}) => ({
  id: TEMPLATE_ID,
  wabaId: "waba-1",
  name: "aviso",
  language: "es_MX",
  metaTemplateId: "hsm-1",
  category: "utility",
  status: "APPROVED",
  body: "Hola {{1}}",
  createdByTenantId: "tenant-1",
  createdByClientAccountId: null,
  syncedAt: new Date(),
  createdAt: new Date(),
  ...overrides,
})

const page = {
  id: "conn-1",
  tenantId: "tenant-1",
  channel: "whatsapp",
  metaPageId: "phone-1",
  name: "Clínica",
}

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

const fetchMock = vi.fn<typeof fetch>()
const hrefOf = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? input.url : String(input)

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
    page,
    wabaId: "waba-1",
    pageAccessToken: "token-1",
  })
  mocks.getWhatsappTemplateById.mockResolvedValue(record())
  mocks.countTemplateUsageByOtherNumbers.mockResolvedValue(0)
  mocks.updateWhatsappTemplateContent.mockImplementation(
    async (input: { body: string; status: string }) =>
      record({ body: input.body, status: input.status })
  )
  mocks.deleteWhatsappTemplateById.mockResolvedValue(undefined)
  fetchMock.mockResolvedValue(jsonResponse({ success: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("PATCH /api/meta/whatsapp/templates/{id}", () => {
  it("edita la propia en Meta y avisa que vuelve a revisión", async () => {
    mocks.countTemplateUsageByOtherNumbers.mockResolvedValue(3)

    const response = await PATCH(
      patchRequest(editBody({ footer: "Clínica" })),
      context()
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      template: {
        id: TEMPLATE_ID,
        status: "PENDING",
        body: "Hola {{1}}, nos vemos.",
        own: true,
      },
      reviewRequired: true,
      usedByOtherNumbers: 3,
    })
    expect(mocks.getActiveWhatsappNumberWithTokenForActor).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        clientAccountId: null,
        phoneNumberId: "phone-1",
      }
    )
    const [input, init] = fetchMock.mock.calls[0]!
    expect(hrefOf(input)).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/hsm-1`
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      components: [
        {
          type: "BODY",
          text: "Hola {{1}}, nos vemos.",
          example: { body_text: [["Ana"]] },
        },
        { type: "FOOTER", text: "Clínica" },
      ],
    })
    expect(mocks.countTemplateUsageByOtherNumbers).toHaveBeenCalledWith({
      wabaId: "waba-1",
      name: "aviso",
      language: "es_MX",
      actor: { tenantId: "tenant-1", clientAccountId: null },
    })
  })

  it("editar una que no estaba aprobada no pide revisión nueva", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ status: "REJECTED" })
    )

    const response = await PATCH(patchRequest(editBody()), context())

    expect(await response.json()).toMatchObject({ reviewRequired: false })
  })

  it.each([
    ["importada por el sync", { createdByTenantId: null }],
    ["de un cliente del padre", { createdByClientAccountId: "client-1" }],
    ["de otro tenant", { createdByTenantId: "tenant-2" }],
  ])("403 si es ajena: %s", async (_case, overrides) => {
    mocks.getWhatsappTemplateById.mockResolvedValue(record(overrides))

    const response = await PATCH(patchRequest(editBody()), context())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "template_not_owned",
      error: expect.stringMatching(/WhatsApp Manager/),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("404 si la plantilla es de otra WABA", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ wabaId: "waba-2" })
    )

    const response = await PATCH(patchRequest(editBody()), context())

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("404 si no existe", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(null)

    const response = await PATCH(patchRequest(editBody()), context())

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "template_not_found" })
  })

  it("404 si el pageId no es un número del tenant", async () => {
    mocks.getActiveWhatsappNumberWithTokenForActor.mockResolvedValue(null)

    const response = await PATCH(patchRequest(editBody()), context())

    expect(response.status).toBe(404)
    expect(mocks.getWhatsappTemplateById).not.toHaveBeenCalled()
  })

  it("409 sin meta_template_id, sin llamar a Meta", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ metaTemplateId: null })
    )

    const response = await PATCH(patchRequest(editBody()), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "template_missing_meta_id",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("400 con un borrador inválido, sin llamar a Meta", async () => {
    const response = await PATCH(
      patchRequest(
        editBody({
          body: { text: "Hola {{1}} y {{3}}.", examples: ["a", "b"] },
        })
      ),
      context()
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: "template_variables_not_sequential",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("devuelve el rechazo de Meta traducido y no toca la fila", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 100, error_subcode: 2388039, message: "x" } },
        { status: 400 }
      )
    )

    const response = await PATCH(patchRequest(editBody()), context())

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: "template_under_review",
      meta: { code: 100, subcode: 2388039 },
    })
    expect(mocks.updateWhatsappTemplateContent).not.toHaveBeenCalled()
  })

  it("401 sin API key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await PATCH(patchRequest(editBody()), context())

    expect(response.status).toBe(401)
  })
})

describe("DELETE /api/meta/whatsapp/templates/{id}", () => {
  it("borra por hsm_id, nunca por name solo, y después la fila", async () => {
    mocks.countTemplateUsageByOtherNumbers.mockResolvedValue(2)

    const response = await DELETE(deleteRequest(), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      deleted: true,
      template: { id: TEMPLATE_ID, name: "aviso", language: "es_MX" },
      usedByOtherNumbers: 2,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0]!
    const url = new URL(hrefOf(input))
    expect(init?.method).toBe("DELETE")
    expect(url.pathname).toBe(`/${META_GRAPH_VERSION}/waba-1/message_templates`)
    expect(url.searchParams.get("hsm_id")).toBe("hsm-1")
    expect(url.searchParams.get("name")).toBe("aviso")
    expect(mocks.deleteWhatsappTemplateById).toHaveBeenCalledWith(TEMPLATE_ID)
  })

  it("409 sin meta_template_id: nunca cae al borrado por nombre", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ metaTemplateId: null })
    )

    const response = await DELETE(deleteRequest(), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "template_missing_meta_id",
      error: expect.stringMatching(/every language/),
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.deleteWhatsappTemplateById).not.toHaveBeenCalled()
  })

  it("403 de la importada (hello_world)", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ name: "hello_world", createdByTenantId: null })
    )

    const response = await DELETE(deleteRequest(), context())

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("si Meta rechaza, la fila queda", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 100, message: "nope" } }, { status: 400 })
    )

    const response = await DELETE(deleteRequest(), context())

    expect(response.status).toBe(400)
    expect(mocks.deleteWhatsappTemplateById).not.toHaveBeenCalled()
  })

  it("si Meta la borró pero la fila no, igual responde 200", async () => {
    mocks.deleteWhatsappTemplateById.mockRejectedValue(new Error("db down"))

    const response = await DELETE(deleteRequest(), context())

    expect(response.status).toBe(200)
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_delete",
        outcome: "failed",
        reason: "internal_error",
      })
    )
  })

  it("400 sin pageId", async () => {
    const response = await DELETE(deleteRequest(""), context())

    expect(response.status).toBe(400)
  })

  it("un id que no es de la base es 404", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(null)

    const response = await DELETE(deleteRequest(), context("no-es-uuid"))

    expect(response.status).toBe(404)
  })
})
