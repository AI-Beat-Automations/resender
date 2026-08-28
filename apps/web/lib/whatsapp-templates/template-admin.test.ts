import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createWhatsappTemplateInGraph: vi.fn(),
  createWhatsappTemplateMirror: vi.fn(),
  getActivePageWithTokenForTenant: vi.fn(),
  listWhatsappTemplates: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/meta/whatsapp-template-client", () => ({
  createWhatsappTemplateInGraph: mocks.createWhatsappTemplateInGraph,
  deleteWhatsappTemplateInGraph: vi.fn(),
  updateWhatsappTemplateInGraph: vi.fn(),
}))

// Sólo lo que toca la base. Las normalizaciones se dejan reales: son puras y
// son parte de lo que se está verificando.
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

vi.mock("@/lib/pages/page-registry", () => ({
  getActivePageWithTokenForTenant: mocks.getActivePageWithTokenForTenant,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import {
  createWhatsappTemplateForTenant,
  listWhatsappTemplatesForTenant,
  parseWhatsappTemplateDraft,
  parseWhatsappTemplateEdit,
} from "./template-admin"

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

const body = (text: string, example?: unknown) => [
  { type: "BODY", text, ...(example ? { example } : {}) },
]

describe("parseWhatsappTemplateDraft", () => {
  const draft = {
    pageId: "phone-1",
    name: "order_update",
    language: "es",
    category: "utility",
    components: body("Your order is on its way."),
  }

  it("accepts a body-only template", () => {
    const result = parseWhatsappTemplateDraft(draft)

    expect(result).toEqual({
      ok: true,
      value: {
        pageId: "phone-1",
        name: "order_update",
        language: "es",
        category: "utility",
        components: [{ type: "BODY", text: "Your order is on its way." }],
      },
    })
  })

  it("requires a pageId, because the WABA is never supplied by the client", () => {
    const result = parseWhatsappTemplateDraft({ ...draft, pageId: "  " })

    expect(result).toMatchObject({ ok: false, error: "invalid_request" })
  })

  it("rejects a name that Meta would reject on sight", () => {
    for (const name of ["Order Update", "order-update", ""]) {
      expect(parseWhatsappTemplateDraft({ ...draft, name })).toMatchObject({
        ok: false,
        error: "invalid_template_name",
      })
    }
  })

  it("rejects the authentication category, which is out of scope", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      category: "authentication",
    })

    expect(result).toMatchObject({
      ok: false,
      error: "invalid_template_category",
    })
    // El mensaje tiene que decir dónde se hace, no sólo que no se puede.
    expect(result.ok ? "" : result.message).toContain("WhatsApp Manager")
  })

  it("accepts the category as Meta writes it, in upper case", () => {
    const result = parseWhatsappTemplateDraft({ ...draft, category: "UTILITY" })

    expect(result).toMatchObject({ ok: true, value: { category: "utility" } })
  })

  it("rejects a body with variables and no example values", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      components: body("Hi {{1}}, your order {{2}} shipped."),
    })

    expect(result).toMatchObject({
      ok: false,
      error: "missing_variable_examples",
    })
  })

  it("rejects a body whose examples do not cover every variable", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      components: body("Hi {{1}}, your order {{2}} shipped.", {
        body_text: [["Ana"]],
      }),
    })

    expect(result).toMatchObject({
      ok: false,
      error: "missing_variable_examples",
    })
  })

  it("nests a flat example array, which is the most common shape mistake", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      components: body("Hi {{1}}.", { body_text: ["Ana"] }),
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        components: [
          {
            type: "BODY",
            text: "Hi {{1}}.",
            example: { body_text: [["Ana"]] },
          },
        ],
      },
    })
  })

  it("counts a repeated variable once", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      components: body("Hi {{1}}, bye {{1}}.", { body_text: [["Ana"]] }),
    })

    expect(result.ok).toBe(true)
  })

  it("does not ask for examples of named variables, which it cannot count", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      components: body("Hi {{customer_name}}."),
    })

    expect(result.ok).toBe(true)
  })

  it("rejects headers and buttons as out of scope for the v1 editor", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      components: [
        { type: "BODY", text: "Hello." },
        { type: "BUTTONS", buttons: [] },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      error: "invalid_template_components",
    })
  })

  it("requires exactly one body and at most one footer", () => {
    expect(
      parseWhatsappTemplateDraft({
        ...draft,
        components: [{ type: "FOOTER", text: "Reply STOP to opt out." }],
      })
    ).toMatchObject({ ok: false, error: "invalid_template_components" })

    expect(
      parseWhatsappTemplateDraft({
        ...draft,
        components: [
          { type: "BODY", text: "a" },
          { type: "FOOTER", text: "b" },
          { type: "FOOTER", text: "c" },
        ],
      })
    ).toMatchObject({ ok: false, error: "invalid_template_components" })
  })

  it("rejects a footer longer than what Meta accepts", () => {
    const result = parseWhatsappTemplateDraft({
      ...draft,
      components: [
        { type: "BODY", text: "Hello." },
        { type: "FOOTER", text: "x".repeat(61) },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      error: "invalid_template_components",
    })
  })
})

describe("parseWhatsappTemplateEdit", () => {
  it("leaves the category alone when it is not supplied", () => {
    const result = parseWhatsappTemplateEdit({
      pageId: "phone-1",
      components: body("Hello."),
    })

    expect(result).toEqual({
      ok: true,
      value: {
        pageId: "phone-1",
        components: [{ type: "BODY", text: "Hello." }],
      },
    })
  })

  it("ignores name and language, which are the template's identity", () => {
    const result = parseWhatsappTemplateEdit({
      pageId: "phone-1",
      name: "another_name",
      language: "en",
      components: body("Hello."),
    })

    expect(result.ok && "name" in result.value).toBe(false)
  })
})

describe("listWhatsappTemplatesForTenant", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(connectedNumber)
  })

  it("marks which templates the tenant can edit and which are read-only", async () => {
    mocks.listWhatsappTemplates.mockResolvedValue([
      mirrorRow(),
      // Importada por el sync: sin dueño, y visible igual porque el catálogo es
      // de la WABA y el número puede enviarla.
      mirrorRow({ id: "tpl-2", name: "imported", createdByTenantId: null }),
      // De otro tenant de la misma WABA.
      mirrorRow({ id: "tpl-3", name: "other", createdByTenantId: "tenant-2" }),
    ])

    const result = await listWhatsappTemplatesForTenant({
      tenantId: "tenant-1",
      pageId: "phone-1",
    })

    expect(result.ok && result.templates.map((t) => [t.name, t.own])).toEqual([
      ["order_update", true],
      ["imported", false],
      ["other", false],
    ])
  })

  it("publishes the raw status only when it could not be normalised", async () => {
    mocks.listWhatsappTemplates.mockResolvedValue([
      mirrorRow(),
      mirrorRow({
        id: "tpl-2",
        name: "surprise",
        status: "unknown",
        rawStatus: "SOMETHING_META_INVENTED",
      }),
    ])

    const result = await listWhatsappTemplatesForTenant({
      tenantId: "tenant-1",
      pageId: "phone-1",
    })

    expect(result.ok && result.templates[0]).not.toHaveProperty("rawStatus")
    expect(result.ok && result.templates[1]).toMatchObject({
      status: "unknown",
      rawStatus: "SOMETHING_META_INVENTED",
    })
  })

  it("fails when the number is not connected for this tenant", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(null)

    const result = await listWhatsappTemplatesForTenant({
      tenantId: "tenant-1",
      pageId: "phone-1",
    })

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: "page_not_connected",
    })
    expect(mocks.listWhatsappTemplates).not.toHaveBeenCalled()
  })

  it("fails when the connection has no WABA on record", async () => {
    mocks.getActivePageWithTokenForTenant.mockResolvedValue({
      ...connectedNumber,
      page: { ...connectedNumber.page, wabaId: null },
    })

    const result = await listWhatsappTemplatesForTenant({
      tenantId: "tenant-1",
      pageId: "phone-1",
    })

    expect(result).toMatchObject({ ok: false, error: "waba_not_resolved" })
  })
})

describe("createWhatsappTemplateForTenant", () => {
  const input = {
    tenantId: "tenant-1",
    pageId: "phone-1",
    name: "order_update",
    language: "es",
    category: "utility" as const,
    components: [{ type: "BODY" as const, text: "Hello." }],
  }

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.getActivePageWithTokenForTenant.mockResolvedValue(connectedNumber)
  })

  it("does not mirror anything when Meta rejects the template", async () => {
    mocks.createWhatsappTemplateInGraph.mockResolvedValue({
      ok: false,
      status: 400,
      metaErrorCode: 132000,
      error: "raw meta text",
      reason: "The template name is already taken in this account.",
    })

    const result = await createWhatsappTemplateForTenant(input)

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "template_create_failed",
      message: "The template name is already taken in this account.",
      metaErrorCode: 132000,
    })
    expect(mocks.createWhatsappTemplateMirror).not.toHaveBeenCalled()
  })

  it("mirrors the row with its owner once Meta accepted it", async () => {
    mocks.createWhatsappTemplateInGraph.mockResolvedValue({
      ok: true,
      id: "hsm-9",
      status: "PENDING",
      category: "utility",
    })
    mocks.createWhatsappTemplateMirror.mockResolvedValue(
      mirrorRow({
        metaTemplateId: "hsm-9",
        status: "PENDING",
        rawStatus: "PENDING",
      })
    )

    const result = await createWhatsappTemplateForTenant(input)

    expect(mocks.createWhatsappTemplateMirror).toHaveBeenCalledWith({
      wabaId: "waba-1",
      name: "order_update",
      language: "es",
      status: "PENDING",
      category: "utility",
      metaTemplateId: "hsm-9",
      createdByTenantId: "tenant-1",
    })
    expect(result).toMatchObject({ ok: true, mirrored: true })
  })

  it("still reports success when the mirror write fails, because Meta already created it", async () => {
    mocks.createWhatsappTemplateInGraph.mockResolvedValue({
      ok: true,
      id: "hsm-9",
      status: "PENDING",
      category: "utility",
    })
    mocks.createWhatsappTemplateMirror.mockRejectedValue(new Error("db down"))

    const result = await createWhatsappTemplateForTenant(input)

    // Contestar un error acá haría que el cliente reintente contra un nombre
    // que Meta ya tomó, y que crea que no tiene una plantilla que sí tiene.
    expect(result).toMatchObject({
      ok: true,
      mirrored: false,
      template: { metaTemplateId: "hsm-9", own: true },
    })
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "template_create", outcome: "failed" })
    )
  })
})
