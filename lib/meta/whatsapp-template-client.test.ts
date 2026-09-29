import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente de WhatsApp lee las credenciales al importarse; este módulo usa
// su transporte, así que hay que sembrarlas antes del import.
vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "meta-app-id")
vi.stubEnv("META_APP_SECRET", "meta-app-secret")

const mocks = vi.hoisted(() => ({ log: vi.fn() }))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

const { META_GRAPH_VERSION } = await import("./graph-version")
const { WhatsappApiError } = await import("./whatsapp-client")
const {
  createWhatsappTemplate,
  deleteWhatsappTemplate,
  editWhatsappTemplate,
  explainWhatsappTemplateAdminError,
  extractWhatsappTemplateBody,
  listWhatsappTemplates,
} = await import("./whatsapp-template-client")

const WABA_ID = "524126980791429"
const TOKEN = "business-token-abc123"

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

const template = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: `hsm-${name}`,
  name,
  language: "en_US",
  status: "APPROVED",
  category: "UTILITY",
  components: [
    { type: "HEADER", format: "TEXT", text: "Hola" },
    { type: "BODY", text: `Cuerpo de ${name} {{1}}` },
  ],
  ...overrides,
})

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  mocks.log.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const hrefOf = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? input.url : String(input)

describe("listWhatsappTemplates", () => {
  it("sigue paging.next hasta el final y junta todas las páginas", async () => {
    const page2 = `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/message_templates?after=CURSOR2`
    const page3 = `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/message_templates?after=CURSOR3`
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [template("a"), template("b")],
          paging: { cursors: {}, next: page2 },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [template("c")], paging: { next: page3 } })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [template("d")], paging: {} }))

    const templates = await listWhatsappTemplates(TOKEN, WABA_ID)

    expect(templates.map((t) => t.name)).toEqual(["a", "b", "c", "d"])
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const first = new URL(hrefOf(fetchMock.mock.calls[0]![0]))
    expect(first.pathname).toBe(
      `/${META_GRAPH_VERSION}/${WABA_ID}/message_templates`
    )
    expect(first.searchParams.get("fields")).toBe(
      "id,name,language,status,category,components"
    )
    expect(hrefOf(fetchMock.mock.calls[1]![0])).toBe(page2)
    expect(hrefOf(fetchMock.mock.calls[2]![0])).toBe(page3)

    // El token va en la cabecera en todas las páginas, nunca en la URL.
    for (const [input, init] of fetchMock.mock.calls) {
      expect(hrefOf(input)).not.toContain(TOKEN)
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${TOKEN}`
      )
    }
  })

  it("mapea cada plantilla: hsm id, categoría en minúsculas y cuerpo", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          template("order_update", { language: "es", status: "PENDING" }),
          template("promo", { category: "MARKETING", components: [] }),
          template("rara", { category: "SOMETHING_NEW" }),
        ],
      })
    )

    const templates = await listWhatsappTemplates(TOKEN, WABA_ID)

    expect(templates).toEqual([
      {
        metaTemplateId: "hsm-order_update",
        name: "order_update",
        language: "es",
        status: "PENDING",
        category: "utility",
        body: "Cuerpo de order_update {{1}}",
      },
      {
        metaTemplateId: "hsm-promo",
        name: "promo",
        language: "en_US",
        status: "APPROVED",
        category: "marketing",
        body: null,
      },
      // Una categoría fuera de las tres queda null en vez de romper el upsert.
      expect.objectContaining({ name: "rara", category: null }),
    ])
  })

  it("descarta las entradas sin nombre, idioma o estado", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          template("ok"),
          template("sin_idioma", { language: undefined }),
          template("sin_estado", { status: "" }),
          { id: "x" },
          "basura",
        ],
      })
    )

    const templates = await listWhatsappTemplates(TOKEN, WABA_ID)

    expect(templates.map((t) => t.name)).toEqual(["ok"])
  })

  it("no sigue un paging.next que apunta fuera del Graph", async () => {
    // El Bearer viaja en esa petición: no puede salir hacia otro host.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [template("a")],
        paging: { next: "https://evil.example.com/steal?after=X" },
      })
    )

    const templates = await listWhatsappTemplates(TOKEN, WABA_ID)

    expect(templates).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("lanza si una página falla: un catálogo a medias no se guarda", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [template("a")],
          paging: {
            next: `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/message_templates?after=C`,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 190, message: "Invalid OAuth access token." } },
          { status: 401 }
        )
      )

    const error = await listWhatsappTemplates(TOKEN, WABA_ID).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(WhatsappApiError)
    expect(error).toMatchObject({
      step: "template_list",
      reason: "template_list_failed",
      metaErrorCode: 190,
    })
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_sync",
        outcome: "failed",
        reason: "template_list_failed",
        accountId: WABA_ID,
        errorCode: 190,
      })
    )
  })
})

describe("extractWhatsappTemplateBody", () => {
  it("devuelve el texto del componente BODY con sus {{n}} intactos", () => {
    expect(
      extractWhatsappTemplateBody([
        { type: "HEADER", text: "Encabezado" },
        { type: "BODY", text: "Hola {{1}}, tu pedido {{2}} salió." },
        { type: "FOOTER", text: "Pie" },
      ])
    ).toBe("Hola {{1}}, tu pedido {{2}} salió.")
  })

  it("acepta el tipo en minúsculas", () => {
    expect(extractWhatsappTemplateBody([{ type: "body", text: "x" }])).toBe("x")
  })

  it("null sin BODY, sin texto o con algo que no es una lista", () => {
    expect(extractWhatsappTemplateBody([{ type: "HEADER", text: "h" }])).toBe(
      null
    )
    expect(extractWhatsappTemplateBody([{ type: "BODY" }])).toBe(null)
    expect(extractWhatsappTemplateBody(null)).toBe(null)
    expect(extractWhatsappTemplateBody({ type: "BODY", text: "x" })).toBe(null)
  })
})

const metaError = (code: number, subcode?: number, extra = {}) => ({
  error: {
    message: "Invalid parameter",
    type: "OAuthException",
    code,
    ...(subcode !== undefined ? { error_subcode: subcode } : {}),
    ...extra,
  },
})

describe("createWhatsappTemplate", () => {
  it("POST a /{waba}/message_templates con la categoría en mayúsculas", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "hsm-9", status: "PENDING", category: "UTILITY" })
    )
    const components = [{ type: "BODY", text: "Hola" }]

    const result = await createWhatsappTemplate(TOKEN, WABA_ID, {
      name: "aviso",
      language: "es_MX",
      category: "utility",
      components,
    })

    expect(result).toEqual({
      ok: true,
      metaTemplateId: "hsm-9",
      status: "PENDING",
    })
    const [input, init] = fetchMock.mock.calls[0]!
    expect(hrefOf(input)).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/message_templates`
    )
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "aviso",
      language: "es_MX",
      category: "UTILITY",
      components,
    })
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${TOKEN}`
    )
  })

  it("devuelve el rechazo traducido y loguea código y subcódigo", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(metaError(100, 2388019), { status: 400 })
    )

    const result = await createWhatsappTemplate(TOKEN, WABA_ID, {
      name: "aviso",
      language: "es_MX",
      category: "utility",
      components: [],
    })

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "template_limit_reached",
      metaErrorCode: 100,
      metaErrorSubcode: 2388019,
    })
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_create",
        outcome: "failed",
        reason: "meta_rejected",
        errorCode: 100,
        errorSubcode: 2388019,
      })
    )
  })

  it("sin traducción, pasa el error_user_msg de Meta tal cual", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        metaError(100, 2388024, {
          error_user_msg: "Content in this language already exists",
        }),
        { status: 400 }
      )
    )

    const result = await createWhatsappTemplate(TOKEN, WABA_ID, {
      name: "aviso",
      language: "es_MX",
      category: "utility",
      components: [],
    })

    expect(result).toMatchObject({
      ok: false,
      code: null,
      error: "Content in this language already exists",
    })
  })

  it("un 5xx de Meta sale como 502 y un fallo de red también", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 500 }))
    const failed = await createWhatsappTemplate(TOKEN, WABA_ID, {
      name: "aviso",
      language: "es_MX",
      category: "utility",
      components: [],
    })
    expect(failed).toMatchObject({ ok: false, status: 502 })

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
    const offline = await createWhatsappTemplate(TOKEN, WABA_ID, {
      name: "aviso",
      language: "es_MX",
      category: "utility",
      components: [],
    })
    expect(offline).toMatchObject({ ok: false, status: 502 })
  })
})

describe("editWhatsappTemplate", () => {
  it("POST a /{template_id} con solo los components", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }))
    const components = [{ type: "BODY", text: "Nuevo" }]

    const result = await editWhatsappTemplate(TOKEN, {
      wabaId: WABA_ID,
      metaTemplateId: "hsm-9",
      components,
    })

    expect(result).toEqual({ ok: true })
    const [input, init] = fetchMock.mock.calls[0]!
    expect(hrefOf(input)).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/hsm-9`
    )
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ components })
  })
})

describe("deleteWhatsappTemplate", () => {
  it("DELETE por hsm_id y name: borra solo ese idioma", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }))

    const result = await deleteWhatsappTemplate(TOKEN, {
      wabaId: WABA_ID,
      metaTemplateId: "hsm-9",
      name: "aviso",
    })

    expect(result).toEqual({ ok: true })
    const [input, init] = fetchMock.mock.calls[0]!
    const url = new URL(hrefOf(input))
    expect(`${url.origin}${url.pathname}`).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/message_templates`
    )
    expect(url.searchParams.get("hsm_id")).toBe("hsm-9")
    expect(url.searchParams.get("name")).toBe("aviso")
    expect(init?.method).toBe("DELETE")
  })
})

describe("explainWhatsappTemplateAdminError", () => {
  it("traduce los subcódigos documentados", () => {
    expect(
      explainWhatsappTemplateAdminError(metaError(100, 2388019))?.code
    ).toBe("template_limit_reached")
    expect(
      explainWhatsappTemplateAdminError(metaError(100, 2388039))?.code
    ).toBe("template_under_review")
    for (const subcode of [2388040, 2388072, 2388073, 2388293, 2388299]) {
      expect(
        explainWhatsappTemplateAdminError(metaError(100, subcode))?.code
      ).toBe("template_invalid_format")
    }
  })

  it("el token vencido se explica como en el resto del canal", () => {
    expect(explainWhatsappTemplateAdminError(metaError(190))?.message).toMatch(
      /reconnect the number/
    )
  })

  it("no inventa: lo no documentado queda sin traducción", () => {
    expect(
      explainWhatsappTemplateAdminError(metaError(100, 2388024))
    ).toBeNull()
    expect(explainWhatsappTemplateAdminError(metaError(100))).toBeNull()
    expect(explainWhatsappTemplateAdminError({})).toBeNull()
  })
})
