import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  deleteWhatsappTemplate: vi.fn(),
  deleteWhatsappTemplateInGraph: vi.fn(),
  getActivePageWithTokenForTenant: vi.fn(),
  getWhatsappTemplateById: vi.fn(),
  hasActiveSubscription: vi.fn(),
  isUserWaitlisted: vi.fn(),
  log: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
  updateWhatsappTemplateInGraph: vi.fn(),
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

vi.mock("@/lib/meta/whatsapp-template-client", () => ({
  createWhatsappTemplateInGraph: vi.fn(),
  deleteWhatsappTemplateInGraph: mocks.deleteWhatsappTemplateInGraph,
  listWhatsappTemplatesInGraph: vi.fn(),
  updateWhatsappTemplateInGraph: mocks.updateWhatsappTemplateInGraph,
}))

vi.mock(
  "@/lib/whatsapp-templates/template-registry",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/whatsapp-templates/template-registry")
    >()),
    deleteWhatsappTemplate: mocks.deleteWhatsappTemplate,
    getWhatsappTemplateById: mocks.getWhatsappTemplateById,
  })
)

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import type { NextRequest } from "next/server"

import { DELETE, PATCH } from "./route"

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

const params = { params: Promise.resolve({ id: "tpl-1" }) }

const patchRequest = (body: Record<string, unknown> = {}) =>
  new Request("https://resender.test/api/meta/whatsapp/templates/tpl-1", {
    method: "PATCH",
    headers: { authorization: "Bearer rk_test" },
    body: JSON.stringify({
      pageId: "phone-1",
      components: [{ type: "BODY", text: "Your order shipped." }],
      ...body,
    }),
  }) as unknown as NextRequest

const deleteRequest = (query = "?pageId=phone-1") =>
  new Request(
    `https://resender.test/api/meta/whatsapp/templates/tpl-1${query}`,
    { method: "DELETE", headers: { authorization: "Bearer rk_test" } }
  ) as unknown as NextRequest

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
  mocks.getWhatsappTemplateById.mockResolvedValue(mirrorRow())
})

describe("PATCH /api/meta/whatsapp/templates/{id}", () => {
  it("edits an approved template and says that it goes back to review", async () => {
    mocks.updateWhatsappTemplateInGraph.mockResolvedValue({ ok: true })

    const response = await PATCH(patchRequest(), params)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.updateWhatsappTemplateInGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "token-1",
        metaTemplateId: "hsm-1",
        components: [{ type: "BODY", text: "Your order shipped." }],
      })
    )
    // Editar una aprobada se permite; lo que no se permite es que el cliente se
    // entere después de que dejó de poder enviarla.
    expect(payload.returnsToReview).toBe(true)
    expect(payload.message).toMatch(/review/i)
  })

  it("rejects a template imported by the sync, and says where to edit it", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      mirrorRow({ createdByTenantId: null })
    )

    const response = await PATCH(patchRequest(), params)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe("template_not_owned")
    // No alcanza con negarlo: la plantilla se ve en el `GET`, así que sin decir
    // dónde se administra el cliente se queda adivinando.
    expect(payload.message).toContain("WhatsApp Manager")
    expect(mocks.updateWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })

  it("rejects a template created by another tenant of the same WABA", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      mirrorRow({ createdByTenantId: "tenant-2" })
    )

    const response = await PATCH(patchRequest(), params)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "template_not_owned",
    })
    expect(mocks.updateWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })

  it("does not let a row of another WABA be addressed at all", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      mirrorRow({ wabaId: "waba-other" })
    )

    const response = await PATCH(patchRequest(), params)

    // 404 y no 403: confirmar la existencia de una plantilla de otra WABA sería
    // contarle a quien prueba ids algo que no es suyo.
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "template_not_found",
    })
    expect(mocks.updateWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })

  it("refuses to edit a row without a Meta id instead of guessing one", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      mirrorRow({ metaTemplateId: null })
    )

    const response = await PATCH(patchRequest(), params)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: "template_missing_meta_id",
    })
    expect(mocks.updateWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })

  it("passes a supplied category through and keeps it optional", async () => {
    mocks.updateWhatsappTemplateInGraph.mockResolvedValue({ ok: true })

    await PATCH(patchRequest(), params)
    expect(
      mocks.updateWhatsappTemplateInGraph.mock.calls[0]![0]
    ).not.toHaveProperty("category")

    await PATCH(patchRequest({ category: "marketing" }), params)
    expect(mocks.updateWhatsappTemplateInGraph.mock.calls[1]![0]).toMatchObject(
      {
        category: "marketing",
      }
    )
  })

  it("reports Meta's rejection with Meta's own status", async () => {
    mocks.updateWhatsappTemplateInGraph.mockResolvedValue({
      ok: false,
      status: 429,
      metaErrorCode: 4,
      error: "raw meta text",
      reason: "Too many template edits. Try again later.",
    })

    const response = await PATCH(patchRequest(), params)

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: "template_update_failed",
      message: "Too many template edits. Try again later.",
    })
  })

  it("rejects a request without an API key before reading anything", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await PATCH(patchRequest(), params)

    expect(response.status).toBe(401)
    expect(mocks.getWhatsappTemplateById).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/meta/whatsapp/templates/{id}", () => {
  it("deletes by hsm_id, which is the only delete that spares the other languages", async () => {
    mocks.deleteWhatsappTemplateInGraph.mockResolvedValue({ ok: true })
    mocks.deleteWhatsappTemplate.mockResolvedValue(true)

    const response = await DELETE(deleteRequest(), params)

    expect(response.status).toBe(200)
    const call = mocks.deleteWhatsappTemplateInGraph.mock.calls[0]![0]
    // El `hsm_id` es lo que decide el alcance del borrado: con él se va una
    // versión de idioma, sin él se van todas y el nombre queda quemado 30 días.
    expect(call.hsmId).toBe("hsm-1")
    expect(call).toMatchObject({ wabaId: "waba-1", name: "order_update" })
    expect(mocks.deleteWhatsappTemplate).toHaveBeenCalledWith("tpl-1")
  })

  it("refuses the delete when the row has no Meta id, and does not fall back to the name", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      mirrorRow({ metaTemplateId: null })
    )

    const response = await DELETE(deleteRequest(), params)
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe("template_missing_meta_id")
    // El error tiene que **explicar** por qué no se borra, porque la
    // alternativa que el cliente imagina —«borralo por nombre»— es exactamente
    // la que se lleva todos los idiomas.
    expect(payload.message).toContain("30 days")
    // Y sobre todo: no se llama a Graph. El fallback por nombre es el desastre
    // que esta rama existe para evitar.
    expect(mocks.deleteWhatsappTemplateInGraph).not.toHaveBeenCalled()
    expect(mocks.deleteWhatsappTemplate).not.toHaveBeenCalled()
  })

  it("keeps the mirror row when Meta refuses the delete", async () => {
    mocks.deleteWhatsappTemplateInGraph.mockResolvedValue({
      ok: false,
      status: 500,
      metaErrorCode: null,
      error: "raw meta text",
      reason: null,
    })

    const response = await DELETE(deleteRequest(), params)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "template_delete_failed",
    })
    // Borrar el espejo acá dejaría la plantilla viva en Meta, invisible en el
    // catálogo y sin el hsm id con el que se podría reintentar.
    expect(mocks.deleteWhatsappTemplate).not.toHaveBeenCalled()
  })

  it("rejects a template imported by the sync", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      mirrorRow({ createdByTenantId: null })
    )

    const response = await DELETE(deleteRequest(), params)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe("template_not_owned")
    expect(payload.message).toContain("WhatsApp Manager")
    expect(mocks.deleteWhatsappTemplateInGraph).not.toHaveBeenCalled()
    expect(mocks.deleteWhatsappTemplate).not.toHaveBeenCalled()
  })

  it("rejects a template created by another tenant of the same WABA", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      mirrorRow({ createdByTenantId: "tenant-2" })
    )

    const response = await DELETE(deleteRequest(), params)

    expect(response.status).toBe(403)
    expect(mocks.deleteWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })

  it("returns 404 when the row does not exist", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(null)

    const response = await DELETE(deleteRequest(), params)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "template_not_found",
    })
  })

  it("requires the pageId that resolves the token and the WABA", async () => {
    const response = await DELETE(deleteRequest(""), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
    expect(mocks.getWhatsappTemplateById).not.toHaveBeenCalled()
  })

  it("does not touch Meta for an account without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const response = await DELETE(deleteRequest(), params)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "no_active_subscription",
    })
    expect(mocks.deleteWhatsappTemplateInGraph).not.toHaveBeenCalled()
  })
})
