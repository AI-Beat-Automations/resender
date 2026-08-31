import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente de onboarding —del que este módulo importa `graphRequest`— lee las
// credenciales de la app al importarse. Se siembran antes del import por el
// mismo motivo que en `whatsapp-client.test.ts`.
vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "meta-app-id")
vi.stubEnv("META_APP_SECRET", "meta-app-secret")

const { META_GRAPH_VERSION } = await import("./graph-version")
const {
  createWhatsappTemplateInGraph,
  deleteWhatsappTemplateInGraph,
  explainWhatsappTemplateAdminError,
  listWhatsappTemplatesInGraph,
  updateWhatsappTemplateInGraph,
} = await import("./whatsapp-template-client")

const WABA_ID = "524126980791429"
const TEMPLATE_ID = "1407680676729941"
// A propósito sin la forma `EAA…` que el logger sabe tachar: si aparece en un
// log o en una URL es porque este módulo lo puso ahí.
const BUSINESS_TOKEN = "business-token-abc123"

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

type GraphCall = { url: string; init?: RequestInit }

// Cola de respuestas: cada llamada se lleva la siguiente, y la última se repite.
// Es lo que hace testeable la paginación sin inventar un router de URLs.
function mockGraph(responses: Array<() => Response>) {
  const calls: GraphCall[] = []
  let index = 0
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: input.toString(), init })
    const handler = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return handler()
  })
  return calls
}

const template = (overrides: Record<string, unknown> = {}) => ({
  id: "1000",
  name: "order_update",
  language: "es",
  status: "APPROVED",
  category: "UTILITY",
  ...overrides,
})

const bodyOf = (call: GraphCall | undefined) =>
  JSON.parse(String(call?.init?.body ?? "null")) as Record<string, unknown>

// El logger escribe con `console.*`. Se capturan las líneas para poder afirmar
// qué **no** sale en ellas.
let consoleLines: unknown[][] = []

beforeEach(() => {
  consoleLines = []
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args)
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("listado del catálogo", () => {
  it("pide los cinco campos del espejo y manda el token en la cabecera", async () => {
    const calls = mockGraph([() => jsonResponse({ data: [template()] })])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(result).toEqual({
      ok: true,
      truncated: false,
      dropped: 0,
      templates: [
        {
          id: "1000",
          name: "order_update",
          language: "es",
          status: "APPROVED",
          category: "utility",
        },
      ],
    })

    const url = new URL(calls[0]?.url ?? "")
    expect(url.origin).toBe("https://graph.facebook.com")
    expect(url.pathname).toBe(
      `/${META_GRAPH_VERSION}/${WABA_ID}/message_templates`
    )
    expect(url.searchParams.get("fields")).toBe(
      "id,name,language,status,category"
    )
    expect(url.searchParams.get("limit")).toBe("100")
    // El token va en `Authorization` y nunca en el query: una URL con el token
    // termina, tarde o temprano, dentro del mensaje de un error.
    expect(url.searchParams.get("access_token")).toBeNull()
    expect(
      (calls[0]?.init?.headers as Record<string, string>).Authorization
    ).toBe(`Bearer ${BUSINESS_TOKEN}`)
  })

  // El caso que motiva la paginación: 6.000 plantillas por WABA es el tope de
  // Meta y una Coexistence de un negocio viejo lo puede rozar.
  it("sigue los cursores y concatena todas las páginas", async () => {
    const calls = mockGraph([
      () =>
        jsonResponse({
          data: [template({ id: "1", name: "a" })],
          paging: {
            cursors: { before: "B0", after: "CURSOR_1" },
            next: "https://graph.facebook.com/next-page-1",
          },
        }),
      () =>
        jsonResponse({
          data: [template({ id: "2", name: "b" })],
          paging: {
            cursors: { before: "B1", after: "CURSOR_2" },
            next: "https://graph.facebook.com/next-page-2",
          },
        }),
      // Última página: trae `cursors.after` igual, pero sin `next`. Es
      // exactamente el caso que haría girar para siempre a un paginador que
      // sólo mirara el cursor.
      () =>
        jsonResponse({
          data: [template({ id: "3", name: "c" })],
          paging: { cursors: { before: "B2", after: "CURSOR_3" } },
        }),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(result).toMatchObject({ ok: true, truncated: false })
    expect(result.ok && result.templates.map((row) => row.name)).toEqual([
      "a",
      "b",
      "c",
    ])

    expect(calls).toHaveLength(3)
    expect(new URL(calls[0]!.url).searchParams.get("after")).toBeNull()
    expect(new URL(calls[1]!.url).searchParams.get("after")).toBe("CURSOR_1")
    expect(new URL(calls[2]!.url).searchParams.get("after")).toBe("CURSOR_2")
    // `fields` y `limit` se rearman en cada página en vez de heredar lo que
    // Meta haya puesto en `paging.next`.
    expect(new URL(calls[2]!.url).searchParams.get("fields")).toBe(
      "id,name,language,status,category"
    )
  })

  // Un cursor que se repite es un bucle infinito dentro de un Worker, y un job
  // de sync colgado se lleva puesta la cola entera.
  it("corta cuando el cursor deja de avanzar, en vez de girar para siempre", async () => {
    const calls = mockGraph([
      () =>
        jsonResponse({
          data: [template({ id: "1", name: "a" })],
          paging: { cursors: { after: "STUCK" }, next: "https://next" },
        }),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    // Dos llamadas: la primera y la que usa el cursor una vez. Al verlo repetido
    // se corta, y lo leído se devuelve marcado como incompleto.
    expect(calls).toHaveLength(2)
    expect(result).toMatchObject({ ok: true, truncated: true })
    expect(result.ok && result.templates).toHaveLength(2)
  })

  it("corta al llegar al tope de páginas y lo dice con truncated", async () => {
    const calls = mockGraph([
      () =>
        jsonResponse({
          data: [template()],
          paging: {
            // Un cursor distinto por página: sin el tope, esto no termina nunca.
            cursors: { after: `C${Math.random()}` },
            next: "https://next",
          },
        }),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      maxPages: 3,
    })

    expect(calls).toHaveLength(3)
    expect(result).toMatchObject({ ok: true, truncated: true })
  })

  // **Un fallo de Graph a mitad del recorrido no tira lo ya leído.** Con 240
  // páginas, la forma más probable de que termine una paginación larga es un
  // throttle en el medio, y devolver el fallo ahí descartaría todo lo que ya
  // está en memoria para espejar cero.
  it("devuelve lo leído cuando Graph falla a mitad de la paginación", async () => {
    const calls = mockGraph([
      () =>
        jsonResponse({
          data: [template({ id: "1", name: "a" })],
          paging: {
            cursors: { after: "CURSOR_1" },
            next: "https://graph.facebook.com/next-page-1",
          },
        }),
      () =>
        jsonResponse(
          { error: { message: "Application request limit reached", code: 4 } },
          { status: 429 }
        ),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(calls).toHaveLength(2)
    expect(result).toMatchObject({ ok: true, truncated: true })
    expect(result.ok && result.templates.map((row) => row.name)).toEqual(["a"])
    // El fallo no desaparece: queda su línea de log con el status y el código
    // de Meta, que es lo que después explica un catálogo a medias.
    expect(
      consoleLines.some(([line]) =>
        JSON.stringify(line).includes("template_list_failed")
      )
    ).toBe(true)
  })

  // El otro lado de la misma regla: sin nada leído no hay media lista que
  // salvar, y el llamador sí necesita el status y el código —el sync los usa
  // para marcar el token inválido—.
  it("devuelve el fallo cuando Graph falla en la primera página", async () => {
    mockGraph([
      () =>
        jsonResponse(
          { error: { message: "Invalid OAuth access token", code: 190 } },
          { status: 401 }
        ),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(result).toMatchObject({ ok: false, status: 401, metaErrorCode: 190 })
  })

  // `next` presente y `cursors.after` ilegible es «hay más páginas y no sé
  // pedirlas», que no es el final del catálogo aunque se le parezca desde acá.
  // Devolverlo como completo hacía que el sync escribiera una sola página y la
  // registrara como `ok`.
  it("no da el catálogo por completo cuando anuncia otra página y el cursor no se puede leer", async () => {
    const calls = mockGraph([
      () =>
        jsonResponse({
          data: [template({ id: "1", name: "a" })],
          paging: { next: "https://graph.facebook.com/next-page-1" },
        }),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    // No se inventa un pedido sin cursor: se corta y se dice.
    expect(calls).toHaveLength(1)
    expect(result).toMatchObject({ ok: true, truncated: true })
    expect(result.ok && result.templates).toHaveLength(1)
  })

  // **El tope de páginas se calcula sobre el peor caso, no sobre el que
  // pedimos.** El `limit` es una preferencia: si Graph lo recorta a 25, una
  // WABA llena son 240 páginas, y el tope viejo (100) cortaba el sync en el
  // 41 % del catálogo. El sync corre con los defaults, así que esto no se puede
  // arreglar desde el llamador.
  it("el tope por defecto alcanza para una WABA llena aunque Graph recorte el limit a 25", async () => {
    let id = 0
    const calls = mockGraph([
      () =>
        jsonResponse({
          data: Array.from({ length: 25 }, () => {
            id += 1
            return template({ id: String(id), name: `t${id}` })
          }),
          paging: {
            cursors: { after: `CURSOR_${id}` },
            next: "https://graph.facebook.com/next-page",
          },
        }),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    // 6.000 es el tope de plantillas por WABA de Meta: el paginador tiene que
    // poder llegar hasta ahí antes de rendirse.
    expect(result.ok && result.templates.length).toBeGreaterThanOrEqual(6000)
    expect(calls.length).toBeGreaterThanOrEqual(240)
  })

  // El espejo llavea por `(waba_id, name, language)` y su columna `category`
  // tiene check: una fila sin identidad no se puede insertar, y una categoría
  // fuera de catálogo haría fallar el insert entero.
  it("descarta las filas sin identidad y normaliza la categoría", async () => {
    mockGraph([
      () =>
        jsonResponse({
          data: [
            template({ id: "1", name: "ok", category: "MARKETING" }),
            template({ id: "2", name: "sin_categoria", category: "COUPON" }),
            template({ id: "3", name: "sin_idioma", language: "" }),
            { name: "sin_id", language: "es", status: "APPROVED" },
            "no es un objeto",
          ],
        }),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(result.ok && result.templates).toEqual([
      {
        id: "1",
        name: "ok",
        language: "es",
        status: "APPROVED",
        category: "marketing",
      },
      {
        id: "2",
        name: "sin_categoria",
        language: "es",
        status: "APPROVED",
        category: null,
      },
    ])

    // Las tres que se cayeron se cuentan. Sin este número, el sync no puede
    // contrastar lo que escribió contra lo que Meta dice tener, y un cambio de
    // forma de la respuesta —que descartaría todo— se vería exactamente igual
    // que una WABA con menos plantillas.
    expect(result.ok && result.dropped).toBe(3)
  })

  // El estado va crudo: la columna de la 0018 no tiene check y el espejo
  // normaliza al leer. Convertirlo acá perdería el estado nuevo para siempre.
  it("no normaliza el estado: lo pasa tal cual lo dijo Meta", async () => {
    mockGraph([
      () => jsonResponse({ data: [template({ status: "SOMETHING_NEW" })] }),
    ])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(result.ok && result.templates[0]?.status).toBe("SOMETHING_NEW")
  })
})

describe("creación", () => {
  const components = [
    {
      type: "BODY" as const,
      text: "Hola {{1}}, tu pedido {{2}} ya salió.",
      // Array **de arrays**: el externo es el conjunto de ejemplos y el interno
      // los valores, en el orden de los `{{n}}`. Sin esto Meta rechaza sola.
      example: { body_text: [["Ana", "A-1234"]] },
    },
    { type: "FOOTER" as const, text: "Jasper's Market" },
  ]

  it("manda el body con la forma exacta que espera Graph", async () => {
    const calls = mockGraph([
      () =>
        jsonResponse({
          id: TEMPLATE_ID,
          status: "PENDING",
          category: "UTILITY",
        }),
    ])

    const result = await createWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      name: "order_update",
      language: "es_AR",
      category: "utility",
      components,
    })

    expect(result).toEqual({
      ok: true,
      id: TEMPLATE_ID,
      status: "PENDING",
      category: "utility",
    })

    const call = calls[0]
    expect(call?.init?.method).toBe("POST")
    expect(new URL(call?.url ?? "").pathname).toBe(
      `/${META_GRAPH_VERSION}/${WABA_ID}/message_templates`
    )
    expect(bodyOf(call)).toEqual({
      name: "order_update",
      // El idioma va tal cual: `es` y `es_AR` son dos plantillas distintas.
      language: "es_AR",
      // Meta habla en mayúsculas; la 0018 guarda en minúsculas.
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Hola {{1}}, tu pedido {{2}} ya salió.",
          example: { body_text: [["Ana", "A-1234"]] },
        },
        { type: "FOOTER", text: "Jasper's Market" },
      ],
    })
    // `allow_category_change` no se manda: dejaría que Meta reclasifique una
    // `utility` como `marketing`, que se factura distinto.
    expect(bodyOf(call)).not.toHaveProperty("allow_category_change")
  })

  // Un 200 sin id deja una plantilla que puede existir y que no podemos ni
  // espejar ni borrar. Se reporta como fallo, pero sin afirmar que no se creó.
  it("trata un 200 sin id como fallo y no promete que no se creó", async () => {
    mockGraph([() => jsonResponse({ status: "PENDING" })])

    const result = await createWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      name: "order_update",
      language: "es",
      category: "utility",
      components,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain("WhatsApp Manager")
  })

  // Los `components` son datos del cliente final —nombres, importes, códigos—
  // y valen lo mismo que el texto de un mensaje, que este repo no loguea.
  it("nunca escribe los components en el log de un fallo", async () => {
    mockGraph([
      () =>
        jsonResponse(
          { error: { message: "Invalid parameter", code: 100 } },
          { status: 400 }
        ),
    ])

    await createWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      name: "order_update",
      language: "es",
      category: "utility",
      components,
    })

    const logged = JSON.stringify(consoleLines)
    expect(logged).not.toContain("Ana")
    expect(logged).not.toContain("A-1234")
    expect(logged).not.toContain(BUSINESS_TOKEN)
    // El nombre sí: lo eligió el negocio y sin él no se puede contestar qué
    // plantilla falló.
    expect(logged).toContain("order_update")
  })
})

describe("edición", () => {
  it("pega contra el id de la plantilla y no contra la WABA", async () => {
    const calls = mockGraph([() => jsonResponse({ success: true })])

    const result = await updateWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      metaTemplateId: TEMPLATE_ID,
      components: [{ type: "BODY", text: "Texto nuevo" }],
    })

    expect(result).toEqual({ ok: true })

    const call = calls[0]
    expect(call?.init?.method).toBe("POST")
    // La edición no cuelga de `/{waba_id}/message_templates`: ese edge no tiene
    // POST de edición.
    expect(new URL(call?.url ?? "").pathname).toBe(
      `/${META_GRAPH_VERSION}/${TEMPLATE_ID}`
    )
    expect(call?.url).not.toContain(WABA_ID)
    expect(call?.url).not.toContain("message_templates")
  })

  // `name` y `language` son la identidad de la plantilla y no se mandan: dos
  // páginas de Meta no coinciden en si son editables, y renombrar no está en el
  // editor v1.
  it("manda sólo los componentes, y la categoría únicamente si se pidió", async () => {
    const calls = mockGraph([() => jsonResponse({ success: true })])

    await updateWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      metaTemplateId: TEMPLATE_ID,
      components: [{ type: "FOOTER", text: "Pie" }],
    })
    expect(bodyOf(calls[0])).toEqual({
      components: [{ type: "FOOTER", text: "Pie" }],
    })

    await updateWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      metaTemplateId: TEMPLATE_ID,
      components: [{ type: "FOOTER", text: "Pie" }],
      category: "marketing",
    })
    expect(bodyOf(calls[1])).toEqual({
      components: [{ type: "FOOTER", text: "Pie" }],
      category: "MARKETING",
    })
  })

  // Un `success: false` explícito contradice al 2xx; cualquier otra forma de
  // 200 se toma por buena, porque reportar un fallo de una edición que sí se
  // aplicó manda al cliente a reintentar y a mandarla a revisión dos veces.
  it("sólo un success:false explícito convierte un 200 en fallo", async () => {
    mockGraph([() => jsonResponse({ success: false })])

    const result = await updateWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      metaTemplateId: TEMPLATE_ID,
      components: [{ type: "BODY", text: "x" }],
    })

    expect(result.ok).toBe(false)
  })
})

describe("borrado", () => {
  // Borrar por `name` se lleva **todas** las versiones de idioma y quema el
  // nombre 30 días. El `hsm_id` es lo que acota el borrado a un solo idioma.
  it("borra por hsm_id, acompañado del name como en el ejemplo de Meta", async () => {
    const calls = mockGraph([() => jsonResponse({ success: true })])

    const result = await deleteWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      hsmId: TEMPLATE_ID,
      name: "order_update",
    })

    expect(result).toEqual({ ok: true })

    const call = calls[0]
    expect(call?.init?.method).toBe("DELETE")
    const url = new URL(call?.url ?? "")
    expect(url.pathname).toBe(
      `/${META_GRAPH_VERSION}/${WABA_ID}/message_templates`
    )
    expect(url.searchParams.get("hsm_id")).toBe(TEMPLATE_ID)
    expect(url.searchParams.get("name")).toBe("order_update")
  })

  // El tipo no alcanza: `metaTemplateId ?? ""` compila igual, y un
  // `?hsm_id=&name=pedido` es exactamente la petición que borra todos los
  // idiomas. Por eso el rechazo es en tiempo de ejecución y **antes** de Graph.
  it("con un hsm_id vacío no llama a Graph: no cae al borrado por nombre", async () => {
    const calls = mockGraph([() => jsonResponse({ success: true })])

    const result = await deleteWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      hsmId: "   ",
      name: "order_update",
    })

    expect(calls).toHaveLength(0)
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(!result.ok && result.reason).toContain("30 days")
  })
})

describe("traducción de los errores de administración", () => {
  const metaError = (code: number, extra: Record<string, unknown> = {}) =>
    jsonResponse(
      { error: { message: `Meta says ${code}`, code, ...extra } },
      { status: 400 }
    )

  // El tope de 6.000 por WABA no se modela: no hay contador ni chequeo previo,
  // se traduce el error (ADR 0014).
  it("explica el tope de plantillas de la WABA y manda a borrar, no a esperar", async () => {
    mockGraph([() => metaError(2388019)])

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      metaErrorCode: 2388019,
      error: "Meta says 2388019",
    })
    expect(!result.ok && result.reason).toMatch(/template limit/i)
    expect(!result.ok && result.reason).toMatch(/30 days/i)
  })

  // El tope de creaciones por hora tampoco se modela: llega como throttle de la
  // WABA y la acción del cliente es esperar.
  it("explica el throttle de la WABA como algo que se resuelve esperando", async () => {
    mockGraph([() => metaError(80008)])

    const result = await createWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      name: "order_update",
      language: "es",
      category: "utility",
      components: [{ type: "BODY", text: "hola" }],
    })

    expect(!result.ok && result.reason).toMatch(/wait a few minutes/i)
  })

  // Los códigos comunes al envío no se reescriben acá: se delega en
  // `explainWhatsappError`, para que no haya dos traducciones que divergan.
  it("delega en el catálogo de envío los códigos que ya estaban traducidos", async () => {
    mockGraph([() => metaError(190)])

    const result = await deleteWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      hsmId: TEMPLATE_ID,
      name: "order_update",
    })

    expect(!result.ok && result.reason).toMatch(/reconnect the number/i)
  })

  // El nombre duplicado no tiene código documentado por Meta. En vez de
  // inventarle uno, se usa el texto que la propia Meta escribió para mostrarle
  // al usuario.
  it("cae en el mensaje de usuario de Meta cuando el código no está en ningún catálogo", async () => {
    mockGraph([
      () =>
        metaError(100, {
          error_user_title: "Template Name Already Exists",
          error_user_msg:
            "A template with this name already exists in this language.",
        }),
    ])

    const result = await createWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      name: "order_update",
      language: "es",
      category: "utility",
      components: [{ type: "BODY", text: "hola" }],
    })

    expect(!result.ok && result.reason).toBe(
      "Template Name Already Exists: A template with this name already exists in this language."
    )
  })

  // Traducir de más es inventarle al cliente una causa que no sabemos: el
  // mensaje crudo de Meta viaja igual, en `error`.
  it("deja reason en null cuando no hay nada que traducir", async () => {
    mockGraph([() => metaError(100)])

    const result = await createWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      name: "order_update",
      language: "es",
      category: "utility",
      components: [{ type: "BODY", text: "hola" }],
    })

    expect(result).toMatchObject({
      ok: false,
      reason: null,
      error: "Meta says 100",
      metaErrorCode: 100,
    })
  })

  it("es una función pura y se puede consultar sin red", () => {
    expect(
      explainWhatsappTemplateAdminError({ error: { code: 2388073 } })
    ).toMatch(/footer/i)
    expect(
      explainWhatsappTemplateAdminError({ error: { code: 2388072 } })
    ).toMatch(/body/i)
    expect(explainWhatsappTemplateAdminError({ error: { code: 999999 } })).toBe(
      null
    )
    expect(explainWhatsappTemplateAdminError(null)).toBe(null)
  })

  // Un DNS caído o un timeout no son un rechazo de Meta: puede que la llamada
  // nunca haya salido, y el mensaje no puede prometer que no cambió nada.
  it("convierte el fallo de red en un 502 en vez de lanzar", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    const result = await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      metaErrorCode: null,
    })
  })
})

// Ninguna llamada puede nacer sin plazo: un `fetch` sin señal se cuelga hasta el
// timeout del runtime, que en un Worker es el de la request entera. Se hereda de
// `graphRequest`, y este test es lo que fija que se siga heredando.
describe("higiene del transporte", () => {
  it("le pone un AbortSignal a las cuatro llamadas", async () => {
    const calls = mockGraph([() => jsonResponse({ data: [], success: true })])

    await listWhatsappTemplatesInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
    })
    await createWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      name: "order_update",
      language: "es",
      category: "utility",
      components: [{ type: "BODY", text: "hola" }],
    })
    await updateWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      metaTemplateId: TEMPLATE_ID,
      components: [{ type: "BODY", text: "hola" }],
    })
    await deleteWhatsappTemplateInGraph({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      hsmId: TEMPLATE_ID,
      name: "order_update",
    })

    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(call.init?.signal).toBeInstanceOf(AbortSignal)
      expect(call.url).not.toContain(BUSINESS_TOKEN)
    }
  })
})
