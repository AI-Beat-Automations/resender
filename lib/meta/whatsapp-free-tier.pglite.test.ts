import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

// El [Cupo gratis de Meta] contra un Postgres real embebido (PGlite), igual que
// `message-log.pglite.test.ts`: lo que importa es qué filas entran en el conteo
// y que la llave de `meta_free_tier_alerts` deduplique de verdad, y eso no se
// prueba con mocks.
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
  sendMetaFreeTierEmail: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/email/meta-free-tier-email", () => ({
  sendMetaFreeTierEmail: mocks.sendMetaFreeTierEmail,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

const { countMetaServiceUsage } = await import("./whatsapp-free-tier-usage")
const { notifyMetaFreeTierThresholds } =
  await import("./whatsapp-free-tier-alerts")
const { metaFreeTierPeriod } = await import("./whatsapp-free-tier")

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations"
)

const OCTOBER = metaFreeTierPeriod(new Date("2026-10-15T00:00:00Z"))
const IN_OCTOBER = new Date("2026-10-10T12:00:00Z")

let tenantId: string
let wamidCounter = 0

async function insertPage(metaPageId: string) {
  const page = await db.query<{ id: string }>(
    `insert into connected_pages (
       tenant_id, meta_page_id, name, page_access_token_encrypted, channel,
       whatsapp_phone_e164
     )
     values ($1, $2, 'Clínica Sonrisa', 'enc', 'whatsapp', '+5215550000000')
     returning id`,
    [tenantId, metaPageId]
  )
  const pageId = page.rows[0]!.id
  const conversation = await db.query<{ id: string }>(
    `insert into conversations (tenant_id, connected_page_id, contact_id)
     values ($1, $2, '5215550000000') returning id`,
    [tenantId, pageId]
  )
  return { pageId, conversationId: conversation.rows[0]!.id }
}

// `count` salientes con el cobro ya guardado, de un solo insert.
async function insertPriced(
  target: { pageId: string; conversationId: string },
  count: number,
  input: {
    category?: string | null
    billable?: boolean
    billedAt?: Date | null
  } = {}
) {
  const first = wamidCounter + 1
  wamidCounter += count
  await db.query(
    `insert into messages (
       tenant_id, conversation_id, connected_page_id, contact_id, direction,
       status, text, meta_message_id, origin, delivery_status,
       meta_billable, meta_pricing_category, meta_billed_at
     )
     select $1, $2, $3, '5215550000000', 'outbound', 'sent', 'hola',
            'wamid.cupo_' || n, 'resender_api', 'delivered', $5, $6, $7
     from generate_series($4::int, $4::int + $8::int - 1) as n`,
    [
      tenantId,
      target.conversationId,
      target.pageId,
      first,
      input.billable ?? false,
      input.category === undefined ? "service" : input.category,
      input.billedAt === undefined ? IN_OCTOBER : input.billedAt,
      count,
    ]
  )
}

function alertPage(pageId: string) {
  return {
    id: pageId,
    tenantId,
    channel: "whatsapp" as const,
    metaPageId: "phone",
    username: null,
    name: "Clínica Sonrisa",
    whatsappPhoneE164: "+5215550000000",
  }
}

beforeAll(async () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }

  const user = await db.query<{ id: string }>(
    `insert into users (email) values ('duena@example.com') returning id`
  )
  tenantId = user.rows[0]!.id
}, 60_000)

describe("countMetaServiceUsage", () => {
  it("cuenta solo los de servicio del número y del mes", async () => {
    const page = await insertPage("phone_count")
    const other = await insertPage("phone_other")

    await insertPriced(page, 5)
    await insertPriced(page, 2, { billable: true })
    // Otra categoría: no es cupo de servicio.
    await insertPriced(page, 3, { category: "utility", billable: true })
    // Un valor que Meta estrene mañana tampoco.
    await insertPriced(page, 1, { category: "categoria_nueva" })
    // Sin categoría (un acuse sin bloque).
    await insertPriced(page, 1, { category: null })
    // Otros meses, pegados a los bordes.
    await insertPriced(page, 4, {
      billedAt: new Date("2026-09-30T23:59:59.999Z"),
    })
    await insertPriced(page, 6, { billedAt: new Date("2026-11-01T00:00:00Z") })
    // En el primer instante del mes sí cuenta.
    await insertPriced(page, 1, { billedAt: new Date("2026-10-01T00:00:00Z") })
    // Todavía sin `delivered`.
    await insertPriced(page, 7, { billedAt: null })
    // Otro número.
    await insertPriced(other, 9)

    const usage = await countMetaServiceUsage([page.pageId], OCTOBER)

    expect(usage.get(page.pageId)).toEqual({ serviceCount: 8, billedCount: 2 })
    expect(usage.has(other.pageId)).toBe(false)
  })

  it("devuelve cada número por separado y omite los que no tienen consumo", async () => {
    const one = await insertPage("phone_many_1")
    const two = await insertPage("phone_many_2")
    const idle = await insertPage("phone_idle")
    await insertPriced(one, 3)
    await insertPriced(two, 4, { billable: true })

    const usage = await countMetaServiceUsage(
      [one.pageId, two.pageId, idle.pageId],
      OCTOBER
    )

    expect(usage.get(one.pageId)).toEqual({ serviceCount: 3, billedCount: 0 })
    expect(usage.get(two.pageId)).toEqual({ serviceCount: 4, billedCount: 4 })
    expect(usage.has(idle.pageId)).toBe(false)
  })

  it("sin números no consulta", async () => {
    expect((await countMetaServiceUsage([], OCTOBER)).size).toBe(0)
  })
})

describe("notifyMetaFreeTierThresholds", () => {
  beforeEach(() => {
    mocks.sendMetaFreeTierEmail.mockReset()
    mocks.sendMetaFreeTierEmail.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      reason: null,
    })
    mocks.log.mockReset()
    vi.stubEnv("BETTER_AUTH_URL", "https://resender.test")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("no manda nada por debajo del 80 %", async () => {
    const page = await insertPage("phone_799")
    await insertPriced(page, 799)

    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)

    expect(mocks.sendMetaFreeTierEmail).not.toHaveBeenCalled()
  })

  it("manda el del 80 % una sola vez por número y por mes", async () => {
    const page = await insertPage("phone_80")
    await insertPriced(page, 800)

    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)
    await insertPriced(page, 1)
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)

    expect(mocks.sendMetaFreeTierEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendMetaFreeTierEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "duena@example.com",
        threshold: 80,
        used: 800,
        limit: 1000,
        phone: "+5215550000000",
        connectionsUrl: "https://resender.test/connections",
      })
    )
  })

  it("dos acuses a la vez sobre el umbral mandan un solo correo", async () => {
    const page = await insertPage("phone_race")
    await insertPriced(page, 850)

    await Promise.all([
      notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER),
      notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER),
    ])

    expect(mocks.sendMetaFreeTierEmail).toHaveBeenCalledTimes(1)
  })

  it("después del 80 % manda el del 100 % una sola vez", async () => {
    const page = await insertPage("phone_100")
    await insertPriced(page, 800)
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)

    await insertPriced(page, 200)
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)
    await insertPriced(page, 200, { billable: true })
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)

    expect(
      mocks.sendMetaFreeTierEmail.mock.calls.map(([input]) => input.threshold)
    ).toEqual([80, 100])
  })

  // Un número que ya pasó los dos umbrales la primera vez que se mira recibe
  // solo el del 100 %: el del 80 % ya no dice nada nuevo.
  it("si cruzó los dos de golpe manda solo el del 100 %", async () => {
    const page = await insertPage("phone_1200")
    await insertPriced(page, 1200)

    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)

    expect(mocks.sendMetaFreeTierEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendMetaFreeTierEmail).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 100 })
    )
  })

  it("el mes nuevo vuelve a avisar", async () => {
    const page = await insertPage("phone_months")
    await insertPriced(page, 800)
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)

    const inNovember = new Date("2026-11-05T00:00:00Z")
    await insertPriced(page, 800, { billedAt: inNovember })
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), inNovember)

    expect(mocks.sendMetaFreeTierEmail).toHaveBeenCalledTimes(2)
  })

  it("si el envío falla suelta el reclamo y el próximo acuse reintenta", async () => {
    const page = await insertPage("phone_retry")
    await insertPriced(page, 800)
    mocks.sendMetaFreeTierEmail.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "boom",
      reason: "http_error",
    })

    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)
    await notifyMetaFreeTierThresholds(alertPage(page.pageId), IN_OCTOBER)

    expect(mocks.sendMetaFreeTierEmail).toHaveBeenCalledTimes(2)
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email_send",
        outcome: "failed",
        reason: "http_error",
      })
    )
  })

  it("no lanza si la base falla", async () => {
    await expect(
      notifyMetaFreeTierThresholds(alertPage("no-es-un-uuid"), IN_OCTOBER)
    ).resolves.toBeUndefined()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "internal_error" })
    )
  })
})
