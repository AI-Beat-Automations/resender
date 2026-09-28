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
const { extractWhatsappTemplateBody, listWhatsappTemplates } =
  await import("./whatsapp-template-client")

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
