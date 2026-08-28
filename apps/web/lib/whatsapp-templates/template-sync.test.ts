import { beforeEach, describe, expect, it, vi } from "vitest"

import type { WhatsappGraphTemplate } from "@/lib/meta/whatsapp-template-client"

const mocks = vi.hoisted(() => ({
  // El doble del driver: `sql` es el tag y `sql.transaction` el batch atómico,
  // que es por donde pasan **todas** las escrituras del espejo.
  sql: Object.assign(vi.fn(), { transaction: vi.fn() }),
  listWhatsappTemplatesInGraph: vi.fn(),
  markPageTokenInvalid: vi.fn(),
  decryptSecret: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getSql: () => mocks.sql }))
vi.mock("@/lib/meta/whatsapp-template-client", () => ({
  listWhatsappTemplatesInGraph: mocks.listWhatsappTemplatesInGraph,
}))
vi.mock("@/lib/pages/page-registry", () => ({
  markPageTokenInvalid: mocks.markPageTokenInvalid,
}))
vi.mock("@/lib/crypto/encryption", () => ({
  decryptSecret: mocks.decryptSecret,
}))
vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import { syncWhatsappTemplateCatalog } from "./template-sync"

// El cliente de Graph y la conexión van mockeados a propósito: este módulo es
// orquestación, y lo que hay que fijar es **qué le pide a cada uno y en qué
// condiciones**. La paginación real la prueba el test del cliente.
//
// Lo que **no** se mockea es el espejo: el `insert … on conflict` lo arma
// `upsertSyncedWhatsappTemplates` en el registry —una sola sentencia para el
// lote y para la fila suelta—, y se deja correr de verdad contra el doble del
// driver para poder afirmar acá qué le pide **este** módulo: qué campos mapea
// de Graph, con qué idioma canónico y en lotes de qué tamaño. Que el
// `coalesce` haga lo que dice lo prueba PGlite en
// `db/migrations/migrations.test.ts`, contra Postgres y por los dos caminos.

// La consulta que se le pidió al driver, con el SQL en una sola línea y sin sus
// comentarios, para poder afirmar sobre la sentencia sin pelearse con la
// indentación del template ni con lo que digan los `--`.
type Query = { text: string; params: unknown[] }

function asQuery(call: unknown[]): Query {
  const [strings, ...params] = call as [TemplateStringsArray, ...unknown[]]
  const text = strings
    .join(" ? ")
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  return { text, params }
}

// La primera consulta es siempre el `select` de la conexión; el resto son los
// upserts del espejo, en el orden en que se armaron.
function upserts(): Query[] {
  return mocks.sql.mock.calls.slice(1).map(asQuery)
}

// Los valores del `values`, por nombre: el orden posicional del template no es
// algo que ningún test tenga que conocer de memoria.
function upsertValues(query: Query) {
  const [
    wabaId,
    name,
    language,
    metaTemplateId,
    category,
    status,
    createdByTenantId,
  ] = query.params
  return {
    wabaId,
    name,
    language,
    metaTemplateId,
    category,
    status,
    createdByTenantId,
  }
}

// Cuántas escrituras entró cada `sql.transaction`. Es el número que decide si
// el job sobrevive a una WABA llena: una subrequest de Workers por lote.
function batchSizes(): number[] {
  return mocks.sql.transaction.mock.calls.map(
    (call) => (call[0] as unknown[]).length
  )
}

function connection(overrides: Record<string, unknown> = {}) {
  mocks.sql.mockResolvedValue([
    {
      tenant_id: "tenant-1",
      waba_id: "waba-1",
      page_access_token_encrypted: "enc",
      status: "active",
      ...overrides,
    },
  ])
}

const graphTemplate = (
  overrides: Partial<WhatsappGraphTemplate> = {}
): WhatsappGraphTemplate => ({
  id: "hsm-1",
  name: "order_update",
  language: "es",
  status: "APPROVED",
  category: "utility",
  ...overrides,
})

function catalogue(
  templates: WhatsappGraphTemplate[],
  options: { truncated?: boolean; dropped?: number } = {}
) {
  mocks.listWhatsappTemplatesInGraph.mockResolvedValue({
    ok: true,
    templates,
    truncated: options.truncated ?? false,
    dropped: options.dropped ?? 0,
  })
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.sql.transaction.mockReset()
  mocks.decryptSecret.mockReturnValue("token-claro")
  connection()
  catalogue([])
})

describe("sync del catálogo de plantillas", () => {
  // El caso grande es real: 6.000 plantillas por WABA, y un sync que se queda
  // con la primera página deja el espejo mintiendo sin que nada falle.
  it("espeja todas las plantillas que el cliente le entrega, no la primera página", async () => {
    catalogue([
      graphTemplate({ id: "hsm-1", name: "a" }),
      graphTemplate({ id: "hsm-2", name: "b" }),
      graphTemplate({ id: "hsm-3", name: "c" }),
      graphTemplate({ id: "hsm-4", name: "d" }),
    ])

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: true, imported: 4, truncated: false })

    expect(upserts().map((query) => upsertValues(query).name)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
  })

  // **El test que sostiene la WABA de 6.000.** Cada consulta del driver HTTP de
  // Neon es un `fetch`, o sea una subrequest de Workers, y el presupuesto es de
  // 1.000 por invocación compartidas entre los 10 jobs del batch de la cola.
  // Fila por fila, un catálogo grande revienta con «Too many subrequests» a
  // mitad del bucle, el reintento muere en el mismo punto y el espejo queda
  // clavado en las primeras mil filas. Si esto se vuelve rojo porque alguien
  // sacó el lote, no lo "arregles" subiendo el número esperado.
  it("agrupa las escrituras en lotes: una subrequest por lote y no por plantilla", async () => {
    catalogue(
      Array.from({ length: 250 }, (_, index) =>
        graphTemplate({ id: `hsm-${index}`, name: `t${index}` })
      )
    )

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: true, imported: 250, truncated: false })

    // Tres escrituras para 250 plantillas, no 250.
    expect(batchSizes()).toEqual([100, 100, 50])
    expect(upserts()).toHaveLength(250)
  })

  it("le pide a Graph el catálogo de la WABA de la conexión, con el token descifrado", async () => {
    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    expect(mocks.decryptSecret).toHaveBeenCalledWith("enc")
    expect(mocks.listWhatsappTemplatesInGraph).toHaveBeenCalledWith({
      accessToken: "token-claro",
      wabaId: "waba-1",
    })
  })

  // Sólo lo que el espejo guarda. Los `components` no se piden ni se guardan:
  // Meta es dueño del contenido y no se resincroniza nunca (ADR 0014).
  it("guarda nombre, idioma, estado crudo, categoría y hsm id — y nada más", async () => {
    catalogue([
      graphTemplate({
        id: "hsm-9",
        name: "cita_recordatorio",
        language: "en_US",
        status: "PENDING",
        category: "marketing",
      }),
    ])

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    const [query] = upserts()
    expect(upsertValues(query!)).toEqual({
      wabaId: "waba-1",
      name: "cita_recordatorio",
      language: "en_US",
      status: "PENDING",
      category: "marketing",
      metaTemplateId: "hsm-9",
      // El séptimo y último valor es el dueño, y desde este camino es siempre
      // `null`: lo que Meta devuelve no dice quién creó la plantilla.
      createdByTenantId: null,
    })
    // Ni un valor más: el espejo no guarda contenido.
    expect(query!.params).toHaveLength(7)
  })

  // El idioma se canoniza con **la misma** función que usa el espejo al
  // escribir desde el CRUD (`normalizeWhatsappTemplateLanguage`): la clave del
  // `on conflict` es `(waba_id, name, language)`, así que una variante sin
  // canonizar duplicaría la fila de una plantilla que ya conocíamos.
  it("canoniza el idioma con la regla del espejo, sin una segunda copia de esa regla", async () => {
    catalogue([graphTemplate({ language: "pt-BR" })])

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    expect(upsertValues(upserts()[0]!).language).toBe("pt_BR")
  })

  // El estado no: la columna no tiene check y un estado que Meta agregó ayer
  // tiene que llegar a la base para que se lo pueda ver.
  it("no normaliza el estado: un estado desconocido llega crudo a la base", async () => {
    catalogue([graphTemplate({ status: "LIMIT_EXCEEDED" })])

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    expect(upsertValues(upserts()[0]!).status).toBe("LIMIT_EXCEEDED")
  })

  it("no escribe nada cuando la WABA no tiene plantillas", async () => {
    catalogue([])

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: true, imported: 0, truncated: false })

    expect(mocks.sql.transaction).not.toHaveBeenCalled()
    expect(upserts()).toHaveLength(0)
  })
})

describe("sync del catálogo — idempotencia", () => {
  // Dos números de la misma WABA se conectan y corren dos syncs. El segundo
  // escribe exactamente las mismas claves que el primero: no hay lectura previa
  // ni comparación, y no puede haber filas de más porque el upsert va por
  // `(waba_id, name, language)`.
  it("un segundo sync de la misma WABA reescribe las mismas claves y no agrega ninguna", async () => {
    catalogue([
      graphTemplate({ id: "hsm-1", name: "a" }),
      graphTemplate({ id: "hsm-2", name: "b" }),
    ])

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    const first = upserts()

    mocks.sql.mockClear()

    // La segunda conexión, de otro tenant, contra la misma WABA.
    connection({ tenant_id: "tenant-2" })
    await syncWhatsappTemplateCatalog({ connectionId: "conn-2" })

    expect(upserts()).toEqual(first)
  })

  it("resuelve el conflicto por (waba_id, name, language) y refresca synced_at", async () => {
    catalogue([graphTemplate()])

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    const { text } = upserts()[0]!
    expect(text).toContain("on conflict (waba_id, name, language) do update")
    expect(text).toContain("synced_at = now()")
    // La categoría y el hsm id no se pisan con nulls: una página de Graph puede
    // venir sin ellos y perder el hsm id deja la fila imposible de borrar por
    // el único camino que borra un solo idioma.
    expect(text).toContain(
      "category = coalesce(excluded.category, whatsapp_templates.category)"
    )
    expect(text).toContain("meta_template_id = coalesce(")
  })

  // **La regla más cara del sync**: una plantilla que el tenant creó desde
  // Resender no puede volverse ajena porque el job la vuelva a ver. Si esto se
  // rompiera, el cliente perdería el permiso de editar y borrar sus propias
  // plantillas y nadie sabría por qué.
  //
  // La garantía es ahora la del `coalesce` compartido —«el dueño existente
  // siempre gana»— y no la de no nombrar la columna: la sentencia es una sola y
  // la comparten el sync y la creación desde el CRUD. Lo que este test cuida es
  // la punta que le toca al sync: que entre con el dueño en `null`, que es lo
  // que hace que el `coalesce` devuelva siempre lo que ya había. Que Postgres
  // resuelva ese `coalesce` como decimos lo prueba el test de PGlite de
  // `db/migrations/migrations.test.ts`, por los dos caminos.
  it("no le atribuye dueño a nada que traiga el sync, ni le saca el que ya tenía", async () => {
    catalogue([graphTemplate()])

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    const { text, params } = upserts()[0]!
    const [, update] = text.split("do update")
    // El dueño que ya estaba va **primero** en el coalesce. Al revés, el sync
    // le sacaría la plantilla a su dueño en cada corrida.
    expect(update?.replace(/\s+/g, " ")).toContain(
      "created_by_tenant_id = coalesce( whatsapp_templates.created_by_tenant_id, excluded.created_by_tenant_id )"
    )
    // La fila nueva nace sin dueño, y el tenant de la conexión no viaja en la
    // consulta por ningún lado —ni siquiera el que disparó el job—.
    expect(upsertValues(upserts()[0]!).createdByTenantId).toBeNull()
    expect(params).not.toContain("tenant-1")
    expect(text).toContain("::uuid")
  })
})

describe("sync del catálogo — lo que sale mal", () => {
  const graphFailure = (overrides: Record<string, unknown> = {}) => {
    mocks.listWhatsappTemplatesInGraph.mockResolvedValue({
      ok: false,
      status: 401,
      metaErrorCode: 190,
      error: "Invalid OAuth access token",
      reason: "token_expired",
      ...overrides,
    })
  }

  // No rompe, pero **se dice**: el gate del envío falla abierto, así que un
  // catálogo que no se importó se ve exactamente igual que una WABA sin
  // plantillas y nadie lo va a reportar nunca.
  it("registra el fallo de Graph y no lanza", async () => {
    graphFailure()

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: false, reason: "graph_failed" })

    expect(mocks.sql.transaction).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_sync",
        outcome: "failed",
        reason: "template_sync_failed",
        wabaId: "waba-1",
        errorCode: 190,
      })
    )
  })

  // Sin esto el job es el único llamador de Graph del canal que ve un 190 y se
  // lo queda: la tarjeta de conexión sigue verde y el catálogo vacío, que es
  // justo la combinación que nadie puede diagnosticar desde afuera.
  it("marca el token inválido cuando Graph dice que venció", async () => {
    graphFailure()

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    expect(mocks.markPageTokenInvalid).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      connectionId: "conn-1",
      error: "Invalid OAuth access token",
    })
  })

  it("no marca el token por un fallo que no es de token", async () => {
    graphFailure({ status: 429, metaErrorCode: 80008 })

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    expect(mocks.markPageTokenInvalid).not.toHaveBeenCalled()
  })

  // Best-effort: marcar el token es un efecto de borde y no puede convertir un
  // fallo de Graph —que no se reintenta— en una excepción que manda el job a la
  // DLQ.
  it("no lanza si no se puede marcar el token, y lo registra", async () => {
    graphFailure()
    mocks.markPageTokenInvalid.mockRejectedValue(new Error("db caída"))

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: false, reason: "graph_failed" })

    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "token_invalidate",
        outcome: "failed",
        reason: "internal_error",
        connectionId: "conn-1",
      })
    )
  })

  // `truncated` es un catálogo a medias, y terminarlo con un `ok` sería la
  // mentira silenciosa que este job existe para no cometer.
  it("guarda lo que trajo pero registra un fallo cuando el catálogo vino cortado", async () => {
    catalogue([graphTemplate({ name: "a" }), graphTemplate({ name: "b" })], {
      truncated: true,
    })

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: true, imported: 2, truncated: true })

    // Lo que llegó se espeja igual: media lista es información.
    expect(upserts()).toHaveLength(2)
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_sync",
        outcome: "failed",
        reason: "template_sync_failed",
        count: 2,
      })
    )
  })

  it("registra un ok cuando el catálogo vino entero", async () => {
    catalogue([graphTemplate()])

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_sync",
        outcome: "ok",
        count: 1,
        droppedCount: 0,
      })
    )
  })

  // Las filas que Graph devolvió y no se pudieron leer se cuentan: sin ese
  // número, `count` no se puede contrastar con lo que Meta dice tener y un
  // cambio de forma de la respuesta se vería igual que una WABA más chica.
  it("reporta cuántas filas de Graph se descartaron por venir sin identidad", async () => {
    catalogue([graphTemplate()], { dropped: 3 })

    await syncWhatsappTemplateCatalog({ connectionId: "conn-1" })

    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, droppedCount: 3 })
    )
  })

  // Un fallo de la base sí sube: la cola reintenta y la importación entera se
  // repite sin duplicar nada. Tragarlo dejaría el espejo a medias para siempre.
  it("deja subir el fallo de la base para que la cola reintente", async () => {
    catalogue([graphTemplate()])
    mocks.sql.transaction.mockRejectedValue(new Error("connection terminated"))

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).rejects.toThrow("connection terminated")
  })

  it("no llama a Graph si la conexión ya no está", async () => {
    mocks.sql.mockResolvedValue([])

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: false, reason: "connection_not_found" })

    expect(mocks.listWhatsappTemplatesInGraph).not.toHaveBeenCalled()
  })

  it("no llama a Graph sobre una conexión desconectada", async () => {
    connection({ status: "disconnected" })

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: false, reason: "connection_not_active" })

    expect(mocks.listWhatsappTemplatesInGraph).not.toHaveBeenCalled()
  })

  // Sin WABA no hay catálogo —la plantilla vive ahí y no en el número—, y una
  // conexión de WhatsApp sin WABA es un invariante roto, no un descarte
  // benigno: por eso va en `failed` y no en `skipped`.
  it("registra un fallo si la conexión no tiene WABA", async () => {
    connection({ waba_id: null })

    await expect(
      syncWhatsappTemplateCatalog({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: false, reason: "missing_waba_id" })

    expect(mocks.listWhatsappTemplatesInGraph).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_sync",
        outcome: "failed",
        reason: "missing_waba_id",
      })
    )
  })
})
