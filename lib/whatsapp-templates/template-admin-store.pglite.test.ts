import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// Lo que la administración de plantillas (issue #194) escribe y lee de la
// copia, contra un Postgres real embebido: el dueño al crear y, sobre todo, la
// consulta del aviso `usedByOtherNumbers`, que cruza conexiones, alcance del
// actor y `messages.template_meta`.
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

const {
  countTemplateUsageByOtherNumbers,
  deleteWhatsappTemplateById,
  getWhatsappTemplateById,
  insertOwnedWhatsappTemplate,
  updateWhatsappTemplateContent,
  upsertSyncedWhatsappTemplates,
} = await import("./template-store")

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations"
)

const WABA = "waba-1"

let padreId: string
let otherTenantId: string
let clientAccountId: string
const pages: Record<string, string> = {}

async function connect(input: {
  tenantId: string
  phone: string
  wabaId: string
  clientAccountId?: string | null
}) {
  const page = await db.query<{ id: string }>(
    `insert into connected_pages (
       tenant_id, client_account_id, meta_page_id, name,
       page_access_token_encrypted, channel, waba_id
     )
     values ($1, $2, $3, $3, 'enc', 'whatsapp', $4)
     returning id`,
    [input.tenantId, input.clientAccountId ?? null, input.phone, input.wabaId]
  )
  return page.rows[0]!.id
}

// Un envío de plantilla desde un número: lo único que mira el aviso es
// `template_meta.name` y `template_meta.language`.
async function sentTemplate(phone: string, name: string, language = "es_MX") {
  const pageId = pages[phone]!
  const page = await db.query<{ tenant_id: string }>(
    `select tenant_id from connected_pages where id = $1`,
    [pageId]
  )
  const tenantId = page.rows[0]!.tenant_id
  const conversation = await db.query<{ id: string }>(
    `insert into conversations (tenant_id, connected_page_id, contact_id)
     values ($1, $2, '5215550000000')
     on conflict (connected_page_id, contact_id) do update set contact_id = excluded.contact_id
     returning id`,
    [tenantId, pageId]
  )
  await db.query(
    `insert into messages (
       tenant_id, conversation_id, connected_page_id, contact_id, direction,
       status, text, origin, template_meta
     )
     values ($1, $2, $3, '5215550000000', 'outbound', 'sent', '',
             'resender_api', $4)`,
    [
      tenantId,
      conversation.rows[0]!.id,
      pageId,
      JSON.stringify({ name, language, components: [] }),
    ]
  )
}

beforeAll(async () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }

  const padre = await db.query<{ id: string }>(
    `insert into users (email) values ('padre@example.com') returning id`
  )
  padreId = padre.rows[0]!.id
  const other = await db.query<{ id: string }>(
    `insert into users (email) values ('otro@example.com') returning id`
  )
  otherTenantId = other.rows[0]!.id
  const client = await db.query<{ id: string }>(
    `insert into client_accounts (tenant_id, name, max_connections)
     values ($1, 'Clínica', 1) returning id`,
    [padreId]
  )
  clientAccountId = client.rows[0]!.id

  // Misma WABA: el padre, su cliente y otro tenant. Más un número de otra
  // WABA que también la envió, que no cuenta.
  pages["phone-padre"] = await connect({
    tenantId: padreId,
    phone: "phone-padre",
    wabaId: WABA,
  })
  pages["phone-cliente"] = await connect({
    tenantId: padreId,
    clientAccountId,
    phone: "phone-cliente",
    wabaId: WABA,
  })
  pages["phone-ajeno"] = await connect({
    tenantId: otherTenantId,
    phone: "phone-ajeno",
    wabaId: WABA,
  })
  pages["phone-otra-waba"] = await connect({
    tenantId: otherTenantId,
    phone: "phone-otra-waba",
    wabaId: "waba-2",
  })
}, 60_000)

beforeEach(async () => {
  await db.exec(`delete from messages`)
  await db.exec(`delete from whatsapp_template_events`)
  await db.exec(`delete from whatsapp_templates`)
})

describe("countTemplateUsageByOtherNumbers", () => {
  it("para el padre cuenta solo los números de la WABA fuera de su tenant", async () => {
    await sentTemplate("phone-padre", "aviso")
    await sentTemplate("phone-cliente", "aviso")
    await sentTemplate("phone-ajeno", "aviso")
    await sentTemplate("phone-ajeno", "aviso")
    await sentTemplate("phone-otra-waba", "aviso")

    const count = await countTemplateUsageByOtherNumbers({
      wabaId: WABA,
      name: "aviso",
      language: "es_MX",
      actor: { tenantId: padreId, clientAccountId: null },
    })

    // El del cliente está en el alcance del padre; el ajeno cuenta una vez
    // aunque la envió dos; el de otra WABA no cuenta.
    expect(count).toBe(1)
  })

  it("para un cliente, el número del padre también es de otro", async () => {
    await sentTemplate("phone-padre", "aviso")
    await sentTemplate("phone-cliente", "aviso")
    await sentTemplate("phone-ajeno", "aviso")

    const count = await countTemplateUsageByOtherNumbers({
      wabaId: WABA,
      name: "aviso",
      language: "es_MX",
      actor: { tenantId: padreId, clientAccountId },
    })

    expect(count).toBe(2)
  })

  it("otro idioma u otro nombre no cuentan", async () => {
    await sentTemplate("phone-ajeno", "aviso", "en_US")
    await sentTemplate("phone-ajeno", "otra")

    const count = await countTemplateUsageByOtherNumbers({
      wabaId: WABA,
      name: "aviso",
      language: "es_MX",
      actor: { tenantId: padreId, clientAccountId: null },
    })

    expect(count).toBe(0)
  })
})

describe("insertOwnedWhatsappTemplate", () => {
  it("guarda la plantilla con su dueño, hsm id y estado", async () => {
    const template = await insertOwnedWhatsappTemplate({
      wabaId: WABA,
      name: "aviso",
      language: "es_MX",
      metaTemplateId: "hsm-1",
      category: "utility",
      status: "PENDING",
      body: "Hola {{1}}",
      createdByTenantId: padreId,
      createdByClientAccountId: null,
    })

    expect(template).toMatchObject({
      wabaId: WABA,
      name: "aviso",
      metaTemplateId: "hsm-1",
      status: "PENDING",
      body: "Hola {{1}}",
      createdByTenantId: padreId,
      createdByClientAccountId: null,
    })
    expect(await getWhatsappTemplateById(template.id)).toEqual(template)
  })

  it("pisa una fila vieja del sync con el mismo nombre e idioma", async () => {
    await upsertSyncedWhatsappTemplates({
      wabaId: WABA,
      templates: [
        {
          metaTemplateId: "hsm-viejo",
          name: "aviso",
          language: "es_MX",
          status: "DELETED",
          category: "marketing",
          body: "Viejo",
        },
      ],
    })

    const template = await insertOwnedWhatsappTemplate({
      wabaId: WABA,
      name: "aviso",
      language: "es_MX",
      metaTemplateId: "hsm-nuevo",
      category: "utility",
      status: "PENDING",
      body: "Nuevo",
      createdByTenantId: padreId,
      createdByClientAccountId: null,
    })

    expect(template).toMatchObject({
      metaTemplateId: "hsm-nuevo",
      status: "PENDING",
      category: "utility",
      body: "Nuevo",
      createdByTenantId: padreId,
    })
    const rows = await db.query(`select id from whatsapp_templates`)
    expect(rows.rows).toHaveLength(1)
  })
})

describe("getWhatsappTemplateById", () => {
  it("un id que no es uuid es null, sin error de la base", async () => {
    expect(await getWhatsappTemplateById("no-es-uuid")).toBeNull()
    expect(
      await getWhatsappTemplateById("00000000-0000-0000-0000-000000000000")
    ).toBeNull()
  })
})

describe("updateWhatsappTemplateContent y deleteWhatsappTemplateById", () => {
  it("actualiza cuerpo y estado, y borra la fila", async () => {
    const template = await insertOwnedWhatsappTemplate({
      wabaId: WABA,
      name: "aviso",
      language: "es_MX",
      metaTemplateId: "hsm-1",
      category: "utility",
      status: "APPROVED",
      body: "Hola {{1}}",
      createdByTenantId: padreId,
      createdByClientAccountId: null,
    })

    const updated = await updateWhatsappTemplateContent({
      id: template.id,
      body: "Buen día {{1}}",
      status: "PENDING",
    })
    expect(updated).toMatchObject({ body: "Buen día {{1}}", status: "PENDING" })
    // El dueño no se toca al editar.
    expect(updated?.createdByTenantId).toBe(padreId)

    await deleteWhatsappTemplateById(template.id)
    expect(await getWhatsappTemplateById(template.id)).toBeNull()
  })
})
