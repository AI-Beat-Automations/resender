import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente de WhatsApp lee las credenciales al importarse.
vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "meta-app-id")
vi.stubEnv("META_APP_SECRET", "meta-app-secret")

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActorByUserId: vi.fn(),
  cookieGet: vi.fn(),
  revalidatePath: vi.fn(),
  countTemplateUsageByOtherNumbers: vi.fn(),
  deleteWhatsappTemplateById: vi.fn(),
  getActiveWhatsappNumberWithTokenForActor: vi.fn(),
  getWhatsappTemplateById: vi.fn(),
  insertOwnedWhatsappTemplate: vi.fn(),
  log: vi.fn(),
  updateWhatsappTemplateContent: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

// Sin cookie `lang` la acción responde en español, que es el idioma de las
// aserciones de abajo (mismo molde que `features/inbox/actions.test.ts`).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}))

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
}))

vi.mock("@/lib/clients/actor", () => ({
  resolveActorByUserId: mocks.resolveActorByUserId,
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActiveWhatsappNumberWithTokenForActor:
    mocks.getActiveWhatsappNumberWithTokenForActor,
}))

// El dominio (`template-admin`) y la regla de dueño son los reales: es lo que
// se prueba. Solo se reemplaza la base; Meta va por `fetch`.
vi.mock("@/lib/whatsapp-templates/template-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/whatsapp-templates/template-store")
  >()),
  countTemplateUsageByOtherNumbers: mocks.countTemplateUsageByOtherNumbers,
  deleteWhatsappTemplateById: mocks.deleteWhatsappTemplateById,
  getWhatsappTemplateById: mocks.getWhatsappTemplateById,
  insertOwnedWhatsappTemplate: mocks.insertOwnedWhatsappTemplate,
  updateWhatsappTemplateContent: mocks.updateWhatsappTemplateContent,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

const { es } = await import("@/content/i18n/app/es")
const { createTemplateAction, deleteTemplateAction, editTemplateAction } =
  await import("./actions")

const TEMPLATE_ID = "0b6f5a4e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"

const CLIENT = {
  tenantId: "tenant-1",
  userId: "user-2",
  clientAccountId: "client-1",
}

const page = {
  id: "conn-1",
  tenantId: "tenant-1",
  clientAccountId: "client-1",
  channel: "whatsapp",
  metaPageId: "phone-1",
  name: "Clínica",
}

const record = (overrides: Record<string, unknown> = {}) => ({
  id: TEMPLATE_ID,
  wabaId: "waba-1",
  name: "aviso",
  language: "es_MX",
  metaTemplateId: "hsm-1",
  category: "utility",
  status: "APPROVED",
  body: "Hola {{1}}, gracias.",
  createdByTenantId: "tenant-1",
  createdByClientAccountId: "client-1",
  syncedAt: new Date(),
  createdAt: new Date(),
  ...overrides,
})

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const editForm = (overrides: Record<string, string> = {}) =>
  form({
    phoneNumberId: "phone-1",
    templateId: TEMPLATE_ID,
    body: "Hola {{1}}, nos vemos.",
    example_1: "Ana",
    ...overrides,
  })

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)

  mocks.cookieGet.mockReturnValue(undefined)
  mocks.getSession.mockResolvedValue({ user: { id: "user-2" } })
  mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: CLIENT })
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
  mocks.insertOwnedWhatsappTemplate.mockImplementation(
    async (input: Record<string, unknown>) => record({ ...input, id: "new-1" })
  )
  mocks.deleteWhatsappTemplateById.mockResolvedValue(undefined)
  fetchMock.mockResolvedValue(jsonResponse({ success: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createTemplateAction", () => {
  it("el cliente crea una plantilla que queda suya", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "hsm-9", status: "PENDING", category: "UTILITY" })
    )

    await expect(
      createTemplateAction(
        {},
        form({
          phoneNumberId: "phone-1",
          name: "aviso_cita",
          language: "es_MX",
          category: "utility",
          body: "Hola {{1}}, gracias.",
          example_1: "Ana",
        })
      )
    ).resolves.toEqual({ ok: true })

    expect(mocks.getActiveWhatsappNumberWithTokenForActor).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        clientAccountId: "client-1",
        phoneNumberId: "phone-1",
      }
    )
    expect(mocks.insertOwnedWhatsappTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "aviso_cita",
        status: "PENDING",
        createdByTenantId: "tenant-1",
        createdByClientAccountId: "client-1",
      })
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates")
  })

  it("valida con las reglas de la API antes de llamar a Meta", async () => {
    await expect(
      createTemplateAction(
        {},
        form({
          phoneNumberId: "phone-1",
          name: "aviso_cita",
          language: "es_MX",
          category: "utility",
          body: "Hola {{1}}, gracias.",
        })
      )
    ).resolves.toEqual({
      error: es.templates.draftErrors.template_example_empty,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("traduce un rechazo documentado de Meta", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "Too many templates",
            code: 100,
            error_subcode: 2388019,
          },
        },
        { status: 400 }
      )
    )

    await expect(
      createTemplateAction(
        {},
        form({
          phoneNumberId: "phone-1",
          name: "aviso_cita",
          language: "es_MX",
          category: "utility",
          body: "Gracias por tu compra.",
        })
      )
    ).resolves.toEqual({ error: es.templates.metaErrors.limitReached })
    expect(mocks.insertOwnedWhatsappTemplate).not.toHaveBeenCalled()
  })

  it("sin sesión no hace nada", async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(createTemplateAction({}, form({}))).resolves.toEqual({
      error: es.actions.notSignedIn,
    })
    expect(
      mocks.getActiveWhatsappNumberWithTokenForActor
    ).not.toHaveBeenCalled()
  })
})

describe("editTemplateAction", () => {
  it("edita la propia y la deja pendiente", async () => {
    await expect(editTemplateAction({}, editForm())).resolves.toEqual({
      ok: true,
    })
    expect(mocks.updateWhatsappTemplateContent).toHaveBeenCalledWith({
      id: TEMPLATE_ID,
      body: "Hola {{1}}, nos vemos.",
      status: "PENDING",
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates")
  })

  it.each([
    ["importada por el sync", { createdByTenantId: null }],
    ["del padre, vista por el cliente", { createdByClientAccountId: null }],
    ["de otro cliente", { createdByClientAccountId: "client-2" }],
  ])("rechaza una ajena: %s", async (_case, overrides) => {
    mocks.getWhatsappTemplateById.mockResolvedValue(record(overrides))

    await expect(editTemplateAction({}, editForm())).resolves.toEqual({
      error: es.templates.notOwned,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.updateWhatsappTemplateContent).not.toHaveBeenCalled()
  })

  it("un id de otra WABA es «no encontramos»", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ wabaId: "waba-ajena" })
    )

    await expect(editTemplateAction({}, editForm())).resolves.toEqual({
      error: es.templates.notFound,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("un número que no es del actor no llega a buscar la plantilla", async () => {
    mocks.getActiveWhatsappNumberWithTokenForActor.mockResolvedValue(null)

    await expect(
      editTemplateAction({}, editForm({ phoneNumberId: "phone-ajeno" }))
    ).resolves.toEqual({ error: es.templates.numberNotConnected })
    expect(mocks.getWhatsappTemplateById).not.toHaveBeenCalled()
  })

  it("muestra el mensaje de Meta tal cual si no está documentado", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "Edit limit reached",
            code: 100,
            error_subcode: 2388024,
          },
        },
        { status: 400 }
      )
    )

    const result = await editTemplateAction({}, editForm())

    expect(result.error).toContain("Edit limit reached")
  })
})

describe("deleteTemplateAction", () => {
  it("borra la propia por hsm id", async () => {
    await expect(
      deleteTemplateAction(
        {},
        form({ phoneNumberId: "phone-1", templateId: TEMPLATE_ID })
      )
    ).resolves.toEqual({ ok: true })

    const [input] = fetchMock.mock.calls[0]!
    const url = new URL(input instanceof Request ? input.url : String(input))
    expect(url.searchParams.get("hsm_id")).toBe("hsm-1")
    expect(mocks.deleteWhatsappTemplateById).toHaveBeenCalledWith(TEMPLATE_ID)
  })

  it("rechaza una ajena sin llamar a Meta", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ createdByClientAccountId: "client-2" })
    )

    await expect(
      deleteTemplateAction(
        {},
        form({ phoneNumberId: "phone-1", templateId: TEMPLATE_ID })
      )
    ).resolves.toEqual({ error: es.templates.notOwned })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.deleteWhatsappTemplateById).not.toHaveBeenCalled()
  })

  it("un id de otra WABA es «no encontramos»", async () => {
    mocks.getWhatsappTemplateById.mockResolvedValue(
      record({ wabaId: "waba-ajena" })
    )

    await expect(
      deleteTemplateAction(
        {},
        form({ phoneNumberId: "phone-1", templateId: TEMPLATE_ID })
      )
    ).resolves.toEqual({ error: es.templates.notFound })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
