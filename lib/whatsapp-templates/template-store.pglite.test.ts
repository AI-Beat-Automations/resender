import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { WhatsappTemplateListing } from "@/lib/meta/whatsapp-template-client"

// La copia local del catálogo contra un Postgres real embebido (PGlite): lo que
// importa es qué hace el `on conflict` con las filas que ya estaban —sobre
// todo con el dueño— y eso no se prueba con mocks.
const db = new PGlite({ extensions: { pgcrypto } })

vi.mock("@/lib/db", () => ({
  getSql:
    () =>
    (strings: TemplateStringsArray, ...params: unknown[]) =>
      db
        .query(
          strings.reduce((text, part, index) => `${text}$${index}${part}`),
          params
        )
        .then((result) => result.rows),
}))

const mocks = vi.hoisted(() => ({
  listWhatsappTemplates: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/meta/whatsapp-template-client", () => ({
  listWhatsappTemplates: mocks.listWhatsappTemplates,
}))

vi.mock("@/lib/crypto/encryption", () => ({
  decryptSecret: (value: string) => `plain:${value}`,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

const {
  applyWhatsappTemplateUpdate,
  findWhatsappTemplate,
  isOwnedByParent,
  listWhatsappTemplatesForWaba,
  normalizeWhatsappTemplateStatus,
  upsertSyncedWhatsappTemplates,
} = await import("./template-store")
const { syncWhatsappTemplates } = await import("./template-sync")

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations"
)

const WABA = "waba-1"

let tenantId: string
let clientAccountId: string
let connectionId: string

const listing = (
  name: string,
  overrides: Partial<WhatsappTemplateListing> = {}
): WhatsappTemplateListing => ({
  metaTemplateId: `hsm-${name}`,
  name,
  language: "en_US",
  status: "APPROVED",
  category: "utility",
  body: `Cuerpo de ${name}`,
  ...overrides,
})

beforeAll(async () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }

  const user = await db.query<{ id: string }>(
    `insert into users (email) values ('padre@example.com') returning id`
  )
  tenantId = user.rows[0]!.id

  const client = await db.query<{ id: string }>(
    `insert into client_accounts (tenant_id, name, max_connections)
     values ($1, 'Clínica', 1) returning id`,
    [tenantId]
  )
  clientAccountId = client.rows[0]!.id

  const page = await db.query<{ id: string }>(
    `insert into connected_pages (
       tenant_id, meta_page_id, name, page_access_token_encrypted, channel,
       waba_id
     )
     values ($1, 'phone-1', 'Clínica Sonrisa', 'enc', 'whatsapp', $2)
     returning id`,
    [tenantId, WABA]
  )
  connectionId = page.rows[0]!.id
})

beforeEach(async () => {
  await db.exec(`delete from whatsapp_template_events`)
  await db.exec(`delete from whatsapp_templates`)
  await db.query(
    `update connected_pages set status = 'active', waba_id = $2 where id = $1`,
    [connectionId, WABA]
  )
  mocks.listWhatsappTemplates.mockReset()
  mocks.log.mockReset()
})

describe("normalizeWhatsappTemplateStatus", () => {
  it("deja pasar los estados conocidos", () => {
    expect(normalizeWhatsappTemplateStatus("APPROVED")).toBe("APPROVED")
    expect(normalizeWhatsappTemplateStatus("LIMIT_EXCEEDED")).toBe(
      "LIMIT_EXCEEDED"
    )
    expect(normalizeWhatsappTemplateStatus("in_review")).toBe("IN_REVIEW")
  })

  it("un estado que no conocemos se lee como unknown", () => {
    expect(normalizeWhatsappTemplateStatus("SOMETHING_NEW")).toBe("unknown")
    expect(normalizeWhatsappTemplateStatus("")).toBe("unknown")
    expect(normalizeWhatsappTemplateStatus(null)).toBe("unknown")
  })
})

describe("upsertSyncedWhatsappTemplates", () => {
  it("guarda el catálogo sin dueño y con el estado tal cual", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [listing("hello_world"), listing("rara", { status: "NEW_ONE" })],
    })

    const rows = await db.query<{
      name: string
      status: string
      created_by_tenant_id: string | null
    }>(
      `select name, status, created_by_tenant_id from whatsapp_templates
       order by name`
    )
    // La columna guarda lo que mandó Meta; la normalización es al leer.
    expect(rows.rows).toEqual([
      { name: "hello_world", status: "APPROVED", created_by_tenant_id: null },
      { name: "rara", status: "NEW_ONE", created_by_tenant_id: null },
    ])

    const listed = await listWhatsappTemplatesForWaba(WABA)
    expect(listed.map((t) => [t.name, t.status])).toEqual([
      ["hello_world", "APPROVED"],
      ["rara", "unknown"],
    ])
  })

  it("un segundo sync no vuelve ajena una plantilla propia", async () => {
    await db.query(
      `insert into whatsapp_templates (
         waba_id, name, language, status, body,
         created_by_tenant_id, created_by_client_account_id
       )
       values ($1, 'propia', 'es', 'PENDING', 'viejo', $2, $3)`,
      [WABA, tenantId, clientAccountId]
    )

    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [
        listing("propia", { language: "es", status: "APPROVED", body: "nuevo" }),
      ],
    })

    const found = await findWhatsappTemplate({
      wabaId: WABA,
      name: "propia",
      language: "es",
    })
    expect(found).toMatchObject({
      status: "APPROVED",
      body: "nuevo",
      metaTemplateId: "hsm-propia",
      createdByTenantId: tenantId,
      createdByClientAccountId: clientAccountId,
    })
  })

  it("es idempotente: dos syncs de la misma WABA dejan una fila por plantilla", async () => {
    const templates = [
      listing("a"),
      listing("a", { language: "es" }),
      listing("b"),
    ]
    await upsertSyncedWhatsappTemplates({ wabaId: WABA, templates })
    await upsertSyncedWhatsappTemplates({ wabaId: WABA, templates })

    const count = await db.query<{ count: number }>(
      `select count(*)::int as count from whatsapp_templates`
    )
    expect(count.rows[0]!.count).toBe(3)
  })

  it("no borra el hsm id que ya tenía si Meta no lo manda", async () => {
    await upsertSyncedWhatsappTemplates({ wabaId: WABA, templates: [listing("a")] })
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [listing("a", { metaTemplateId: null })],
    })

    const found = await findWhatsappTemplate({
      wabaId: WABA,
      name: "a",
      language: "en_US",
    })
    expect(found?.metaTemplateId).toBe("hsm-a")
  })

  it("tolera un (name, language) repetido en el mismo listado", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [listing("a", { body: "uno" }), listing("a", { body: "dos" })],
    })

    const listed = await listWhatsappTemplatesForWaba(WABA)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.body).toBe("dos")
  })

  it("solo lista la WABA pedida", async () => {
    await upsertSyncedWhatsappTemplates({ wabaId: WABA, templates: [listing("a")] })
    await upsertSyncedWhatsappTemplates({
      wabaId: "otra-waba",
      templates: [listing("b")],
    })

    const listed = await listWhatsappTemplatesForWaba(WABA)
    expect(listed.map((t) => t.name)).toEqual(["a"])
  })
})

describe("isOwnedByParent", () => {
  it("solo la del padre: tenant propio y sin cliente", () => {
    expect(
      isOwnedByParent(
        { createdByTenantId: "t1", createdByClientAccountId: null },
        "t1"
      )
    ).toBe(true)
    expect(
      isOwnedByParent(
        { createdByTenantId: "t1", createdByClientAccountId: "c1" },
        "t1"
      )
    ).toBe(false)
    expect(
      isOwnedByParent(
        { createdByTenantId: "t2", createdByClientAccountId: null },
        "t1"
      )
    ).toBe(false)
    expect(
      isOwnedByParent(
        { createdByTenantId: null, createdByClientAccountId: null },
        "t1"
      )
    ).toBe(false)
  })
})

describe("syncWhatsappTemplates (job template_sync)", () => {
  it("lista con el token de la conexión y guarda el catálogo de su WABA", async () => {
    mocks.listWhatsappTemplates.mockResolvedValue([listing("hello_world")])

    const outcome = await syncWhatsappTemplates({ connectionId })

    expect(outcome).toEqual({ ok: true, count: 1 })
    expect(mocks.listWhatsappTemplates).toHaveBeenCalledWith("plain:enc", WABA)
    const listed = await listWhatsappTemplatesForWaba(WABA)
    expect(listed.map((t) => t.name)).toEqual(["hello_world"])
  })

  it("descarta, sin llamar a Graph, una conexión desconectada", async () => {
    await db.query(
      `update connected_pages set status = 'disconnected' where id = $1`,
      [connectionId]
    )

    const outcome = await syncWhatsappTemplates({ connectionId })

    expect(outcome).toEqual({
      ok: false,
      permanent: true,
      reason: "connection_not_active",
    })
    expect(mocks.listWhatsappTemplates).not.toHaveBeenCalled()
  })

  it("descarta una conexión que ya no existe", async () => {
    const outcome = await syncWhatsappTemplates({
      connectionId: "00000000-0000-0000-0000-000000000000",
    })

    expect(outcome).toMatchObject({ ok: false, reason: "connection_not_active" })
  })

  it("deja salir el fallo de Graph para que la cola reintente", async () => {
    mocks.listWhatsappTemplates.mockRejectedValue(new Error("graph down"))

    await expect(syncWhatsappTemplates({ connectionId })).rejects.toThrow(
      "graph down"
    )
  })
})

describe("applyWhatsappTemplateUpdate (issue #193)", () => {
  const update = (
    overrides: Partial<Parameters<typeof applyWhatsappTemplateUpdate>[0]> = {}
  ) =>
    applyWhatsappTemplateUpdate({
      wabaId: WABA,
      metaTemplateId: "hsm-bienvenida",
      name: "bienvenida",
      language: "en_US",
      status: "APPROVED",
      category: null,
      reason: null,
      ...overrides,
    })

  const events = async () =>
    (
      await db.query<{ status: string; reason: string | null }>(
        `select status, reason from whatsapp_template_events order by created_at`
      )
    ).rows

  it("actualiza el estado de la fila del sync y escribe un evento", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [listing("bienvenida", { status: "PENDING" })],
    })

    const result = await update({ status: "APPROVED" })

    expect(result).toMatchObject({
      kind: "status_changed",
      event: {
        wabaId: WABA,
        name: "bienvenida",
        language: "en_US",
        status: "APPROVED",
        previousStatus: "PENDING",
        category: "utility",
      },
    })
    const stored = await findWhatsappTemplate({
      wabaId: WABA,
      name: "bienvenida",
      language: "en_US",
    })
    expect(stored?.status).toBe("APPROVED")
    // El cuerpo no se toca: el webhook no lo trae.
    expect(stored?.body).toBe("Cuerpo de bienvenida")
    expect(await events()).toEqual([{ status: "APPROVED", reason: null }])
  })

  // Un reintento de Meta, o un `APPROVED` que el sync ya había traído.
  it("el mismo estado repetido no genera un evento nuevo", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [listing("bienvenida", { status: "PENDING" })],
    })

    expect((await update()).kind).toBe("status_changed")
    expect((await update()).kind).toBe("unchanged")
    expect(await events()).toHaveLength(1)

    // Un cambio real después sí escribe el segundo.
    expect(
      (await update({ status: "PAUSED", reason: "FIRST_PAUSE" })).kind
    ).toBe("status_changed")
    expect(await events()).toEqual([
      { status: "APPROVED", reason: null },
      { status: "PAUSED", reason: "FIRST_PAUSE" },
    ])
  })

  it("busca primero por meta_template_id", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [listing("bienvenida", { status: "PENDING" })],
    })

    // Mismo id, otro idioma escrito distinto: la encuentra igual.
    const result = await update({ language: "en_GB" })

    expect(result.kind).toBe("status_changed")
    const rows = await listWhatsappTemplatesForWaba(WABA)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ language: "en_US", status: "APPROVED" })
  })

  it("si no está el id, busca por (waba, name, language) y lo completa", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [
        listing("bienvenida", { status: "PENDING", metaTemplateId: null }),
      ],
    })

    await update({ metaTemplateId: "hsm-nuevo" })

    const [row] = await listWhatsappTemplatesForWaba(WABA)
    expect(row).toMatchObject({ metaTemplateId: "hsm-nuevo", status: "APPROVED" })
  })

  // Una plantilla recién creada en WhatsApp Manager, antes de cualquier sync.
  it("crea la fila sin dueño ni cuerpo cuando la copia no la conoce", async () => {
    const result = await update({ status: "PENDING", category: "marketing" })

    expect(result).toMatchObject({
      kind: "status_changed",
      event: { status: "PENDING", previousStatus: null },
    })
    const [row] = await listWhatsappTemplatesForWaba(WABA)
    expect(row).toMatchObject({
      name: "bienvenida",
      status: "PENDING",
      category: "marketing",
      body: null,
      createdByTenantId: null,
      createdByClientAccountId: null,
    })
  })

  it("una recategorización cambia la categoría sin escribir evento", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [listing("bienvenida")],
    })

    const result = await update({ status: null, category: "marketing" })

    expect(result.kind).toBe("unchanged")
    const [row] = await listWhatsappTemplatesForWaba(WABA)
    expect(row).toMatchObject({ status: "APPROVED", category: "marketing" })
    expect(await events()).toEqual([])
  })

  it("una recategorización de una plantilla desconocida no crea nada", async () => {
    const result = await update({ status: null, category: "marketing" })

    expect(result).toEqual({ kind: "not_found" })
    expect(await listWhatsappTemplatesForWaba(WABA)).toEqual([])
  })

  it("no toca la plantilla homónima de otra WABA", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: "waba-2",
      templates: [listing("bienvenida", { status: "PENDING" })],
    })

    await update({ metaTemplateId: null, status: "REJECTED" })

    const [other] = await listWhatsappTemplatesForWaba("waba-2")
    expect(other?.status).toBe("PENDING")
  })
})
