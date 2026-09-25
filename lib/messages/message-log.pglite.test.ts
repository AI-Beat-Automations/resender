import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { beforeAll, describe, expect, it, vi } from "vitest"

// El dato de cobro de Meta (migración 0029) se escribe con dos UPDATE guardados
// que se ignoran entre sí, y lo que importa es cómo se combinan cuando Meta
// entrega los acuses desordenados. Eso no se prueba con mocks: corre contra un
// Postgres real embebido (PGlite), igual que `request-logs.pglite.test.ts`.
const db = new PGlite({ extensions: { pgcrypto } })

// El mismo disfraz de `lib/db.ts`: tag de postgres.js sobre un cliente que
// habla `query(texto, params)`.
vi.mock("@/lib/db", () => ({
  getSql: () => (strings: TemplateStringsArray, ...params: unknown[]) =>
    db
      .query(
        strings.reduce(
          (text, part, index) => `${text}$${index}${part}`
        ),
        params
      )
      .then((result) => result.rows),
}))

const { updateDeliveryStatus, updateMetaPricing } = await import(
  "./message-log"
)

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations"
)

let tenantId: string
let pageId: string
let conversationId: string
let wamidCounter = 0

const SENT_AT = new Date("2026-10-02T15:00:00Z")
const DELIVERED_AT = new Date("2026-10-02T15:00:03Z")

const SERVICE_BILLABLE = {
  billable: true,
  category: "service",
  type: "regular",
  pricingModel: "PMP",
}

type PricingRow = {
  delivery_status: string | null
  meta_billable: boolean | null
  meta_pricing_category: string | null
  meta_pricing_type: string | null
  meta_pricing_model: string | null
  meta_billed_at: Date | null
}

async function insertOutbound() {
  wamidCounter += 1
  const wamid = `wamid.cobro_${wamidCounter}`
  await db.query(
    `insert into messages (
       tenant_id, conversation_id, connected_page_id, contact_id, direction,
       status, text, meta_message_id, origin, delivery_status
     )
     values ($1, $2, $3, '5215550000000', 'outbound', 'sent', 'hola', $4,
             'resender_api', 'accepted')`,
    [tenantId, conversationId, pageId, wamid]
  )
  return wamid
}

async function pricingOf(wamid: string) {
  const result = await db.query<PricingRow>(
    `select delivery_status, meta_billable, meta_pricing_category,
            meta_pricing_type, meta_pricing_model, meta_billed_at
     from messages where meta_message_id = $1`,
    [wamid]
  )
  return result.rows[0]!
}

// Lo que hace la ingesta con cada acuse: primero el estado, después el cobro.
async function ack(
  wamid: string,
  deliveryStatus: "sent" | "delivered" | "read",
  reportedAt: Date,
  pricing: typeof SERVICE_BILLABLE | null
) {
  const applied = await updateDeliveryStatus({
    connectedPageId: pageId,
    metaMessageId: wamid,
    deliveryStatus,
  })
  const priced = pricing
    ? await updateMetaPricing({
        connectedPageId: pageId,
        metaMessageId: wamid,
        deliveryStatus,
        reportedAt,
        pricing,
      })
    : null
  return { applied, priced }
}

beforeAll(async () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }

  const user = await db.query<{ id: string }>(
    `insert into users (email) values ('cobro@example.com') returning id`
  )
  tenantId = user.rows[0]!.id

  const page = await db.query<{ id: string }>(
    `insert into connected_pages (
       tenant_id, meta_page_id, name, page_access_token_encrypted, channel
     )
     values ($1, 'phone_1', 'Clínica Sonrisa', 'enc', 'whatsapp') returning id`,
    [tenantId]
  )
  pageId = page.rows[0]!.id

  const conversation = await db.query<{ id: string }>(
    `insert into conversations (tenant_id, connected_page_id, contact_id)
     values ($1, $2, '5215550000000') returning id`,
    [tenantId, pageId]
  )
  conversationId = conversation.rows[0]!.id
}, 60_000)

describe("updateMetaPricing", () => {
  it("guarda el cobro del delivered con el momento de la entrega", async () => {
    const wamid = await insertOutbound()

    await ack(wamid, "delivered", DELIVERED_AT, SERVICE_BILLABLE)

    expect(await pricingOf(wamid)).toEqual({
      delivery_status: "delivered",
      meta_billable: true,
      meta_pricing_category: "service",
      meta_pricing_type: "regular",
      meta_pricing_model: "PMP",
      meta_billed_at: DELIVERED_AT,
    })
  })

  // Meta cobra al entregar. El `delivered` atrasado no mueve el palomita azul,
  // pero su cobro tiene que quedar: si no, el conteo del mes sale corto.
  it("guarda el cobro de un delivered que llega después del read", async () => {
    const wamid = await insertOutbound()

    await ack(wamid, "read", DELIVERED_AT, null)
    const late = await ack(wamid, "delivered", DELIVERED_AT, SERVICE_BILLABLE)

    expect(late).toEqual({ applied: false, priced: true })
    expect(await pricingOf(wamid)).toMatchObject({
      delivery_status: "read",
      meta_billable: true,
      meta_billed_at: DELIVERED_AT,
    })
  })

  it("el delivered con cobro pisa al sent sin cobro", async () => {
    const wamid = await insertOutbound()

    await ack(wamid, "sent", SENT_AT, {
      ...SERVICE_BILLABLE,
      billable: false,
    })
    expect(await pricingOf(wamid)).toMatchObject({
      meta_billable: false,
      meta_billed_at: null,
    })

    await ack(wamid, "delivered", DELIVERED_AT, SERVICE_BILLABLE)
    expect(await pricingOf(wamid)).toMatchObject({
      meta_billable: true,
      meta_billed_at: DELIVERED_AT,
    })
  })

  // El orden inverso: el `sent` atrasado no le pisa el bloque al `delivered`.
  it("un sent atrasado no pisa el cobro del delivered", async () => {
    const wamid = await insertOutbound()

    await ack(wamid, "delivered", DELIVERED_AT, SERVICE_BILLABLE)
    const late = await ack(wamid, "sent", SENT_AT, {
      ...SERVICE_BILLABLE,
      billable: false,
    })

    expect(late.priced).toBe(false)
    expect(await pricingOf(wamid)).toMatchObject({
      meta_billable: true,
      meta_billed_at: DELIVERED_AT,
    })
  })

  // Meta reintenta los callbacks. El reintento no mueve la fecha de cobro: si
  // lo hiciera, un reintento a fin de mes cambiaría el mes del cobro.
  it("es idempotente ante el reintento del mismo delivered", async () => {
    const wamid = await insertOutbound()

    await ack(wamid, "delivered", DELIVERED_AT, SERVICE_BILLABLE)
    const before = await pricingOf(wamid)
    await ack(
      wamid,
      "delivered",
      new Date("2026-10-02T15:09:00Z"),
      SERVICE_BILLABLE
    )

    expect(await pricingOf(wamid)).toEqual(before)
  })

  // Sin CHECK (0029): una categoría que Meta estrene mañana se guarda tal cual.
  it("guarda una categoría desconocida tal cual llega", async () => {
    const wamid = await insertOutbound()

    await ack(wamid, "delivered", DELIVERED_AT, {
      ...SERVICE_BILLABLE,
      category: "service_intervention",
      type: "free_customer_service",
      pricingModel: "PMP_V2",
    })

    expect(await pricingOf(wamid)).toMatchObject({
      meta_pricing_category: "service_intervention",
      meta_pricing_type: "free_customer_service",
      meta_pricing_model: "PMP_V2",
    })
  })

  it("no toca nada con un wamid ajeno", async () => {
    const { priced } = await ack(
      "wamid.no_existe",
      "delivered",
      DELIVERED_AT,
      SERVICE_BILLABLE
    )
    expect(priced).toBe(false)
  })
})
