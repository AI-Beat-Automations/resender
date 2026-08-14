import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createTestDatabase, type TestDatabase } from "@/test/pglite"

// El onboarding de WhatsApp **contra Postgres de verdad** (PGlite).
//
// `page-registry.test.ts` fija el comportamiento contra un `sql` de mentira, que
// es donde se ve por qué se filtra cada consulta y cómo se traduce un 23505. Lo
// que ese doble no puede fallar nunca es lo que decide Postgres: un bind cuyo
// tipo no sabe inferir, un check que rechaza el valor, un unique que no salta,
// una columna que no existe. Este archivo cubre esa mitad para las sentencias
// del canal, que son código nuevo y nunca habían corrido contra una base real.

const holder = vi.hoisted(() => ({ sql: undefined as unknown }))

vi.mock("@/lib/db", () => ({
  getSql: () => holder.sql,
}))

// Cifrado reversible y visible, igual que en el test hermano: lo que se está
// comprobando acá es qué columna guarda el secreto, no el algoritmo (que tiene
// sus propias pruebas).
vi.mock("@/lib/crypto/encryption", () => ({
  encryptSecret: (value: string) => `enc(${value})`,
  decryptSecret: (value: string) => value.replace(/^enc\(|\)$/g, ""),
}))

import {
  connectWhatsappNumber,
  countActiveWhatsappNumbersInWaba,
  getGeneratedWhatsappPin,
  PageOwnershipError,
  resolveWhatsappNumberOwnership,
  type WhatsappNumberInput,
} from "./page-registry"

const PHONE_NUMBER_ID = "109876543210987"
const WABA_ID = "102030405060708"

let database: TestDatabase
let tenantId: string
let otherTenantId: string

beforeAll(async () => {
  database = await createTestDatabase()
  holder.sql = database.sql
}, 60_000)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.db.exec(
    `truncate table connected_pages, users restart identity cascade`
  )
  tenantId = await insertTenant("dueño@example.test")
  otherTenantId = await insertTenant("ajeno@example.test")
})

describe("connectWhatsappNumber contra Postgres", () => {
  it("inserta el número con su identidad de canal y los dos secretos cifrados", async () => {
    const page = await connectWhatsappNumber(tenantId, numberInput())

    expect(page).toMatchObject({
      tenantId,
      channel: "whatsapp",
      metaPageId: PHONE_NUMBER_ID,
      name: "Vetta Clínica",
      wabaId: WABA_ID,
      phoneE164: "+5215512345678",
      status: "active",
      tokenStatus: "valid",
    })

    const row = await one(
      `select page_access_token_encrypted, whatsapp_pin_encrypted,
         whatsapp_pin_generated, onboarding_mode, token_expires_at
       from connected_pages`
    )
    expect(row).toMatchObject({
      page_access_token_encrypted: "enc(business-token)",
      whatsapp_pin_encrypted: "enc(042713)",
      whatsapp_pin_generated: true,
      onboarding_mode: "standard",
      token_expires_at: null,
    })
  })

  it("reconectar es un update de la misma fila, no una segunda", async () => {
    const first = await connectWhatsappNumber(tenantId, numberInput())
    await database.db.query(
      `update connected_pages set status = 'disconnected', disconnected_at = now()`
    )

    const second = await connectWhatsappNumber(
      tenantId,
      numberInput({
        verifiedName: "Vetta Clínica Veterinaria",
        accessToken: "token-nuevo",
        pinOrigin: "stored",
      })
    )

    expect(second.id).toBe(first.id)
    expect(second.status).toBe("active")
    expect(await count("connected_pages")).toBe(1)
    const row = await one(
      `select name, page_access_token_encrypted, whatsapp_pin_generated,
         disconnected_at
       from connected_pages`
    )
    expect(row).toMatchObject({
      name: "Vetta Clínica Veterinaria",
      page_access_token_encrypted: "enc(token-nuevo)",
      // `stored` no toca la marca de origen: quien lo generó lo generó, y
      // pisarla escondería el PIN justo cuando el cliente lo necesita. El
      // `coalesce(...::boolean, ...)` que lo consigue solo se puede comprobar
      // ejecutándolo.
      whatsapp_pin_generated: true,
      disconnected_at: null,
    })
  })

  it("un PIN que aportó el cliente no queda marcado como nuestro", async () => {
    await connectWhatsappNumber(
      tenantId,
      numberInput({ pinOrigin: "customer", pin: "998877" })
    )

    const row = await one(
      `select whatsapp_pin_generated, whatsapp_pin_encrypted from connected_pages`
    )
    expect(row.whatsapp_pin_generated).toBe(false)
    expect(row.whatsapp_pin_encrypted).toBe("enc(998877)")
  })

  it("rechaza el número que ya es de otro tenant", async () => {
    await connectWhatsappNumber(otherTenantId, numberInput())

    await expect(
      connectWhatsappNumber(tenantId, numberInput())
    ).rejects.toBeInstanceOf(PageOwnershipError)
    expect(await count("connected_pages")).toBe(1)
  })

  // Un `phone_number_id` puede coincidir con un page id de Facebook sin que eso
  // signifique nada: el unique es por canal desde la 0013.
  it("no confunde el número con una página de Messenger del mismo id", async () => {
    await database.db.query(
      `insert into connected_pages (
         tenant_id, channel, meta_page_id, name, page_access_token_encrypted
       ) values ($1, 'messenger', $2, 'Página', 'enc(x)')`,
      [otherTenantId, PHONE_NUMBER_ID]
    )

    const page = await connectWhatsappNumber(tenantId, numberInput())

    expect(page.channel).toBe("whatsapp")
    expect(await count("connected_pages")).toBe(2)
  })

  it("acepta el modo coexistence, que es el otro valor del check", async () => {
    const page = await connectWhatsappNumber(
      tenantId,
      numberInput({ onboardingMode: "coexistence" })
    )

    expect(page.id).toBeTruthy()
    const row = await one(`select onboarding_mode from connected_pages`)
    expect(row.onboarding_mode).toBe("coexistence")
  })
})

describe("resolveWhatsappNumberOwnership contra Postgres", () => {
  it("devuelve el PIN guardado para reusarlo en la reconexión", async () => {
    await connectWhatsappNumber(tenantId, numberInput())

    await expect(
      resolveWhatsappNumberOwnership(tenantId, PHONE_NUMBER_ID)
    ).resolves.toEqual({
      ownedByOtherTenant: false,
      activeForTenant: true,
      storedPin: "042713",
    })
  })

  it("no descifra el secreto de otro tenant", async () => {
    await connectWhatsappNumber(otherTenantId, numberInput())

    await expect(
      resolveWhatsappNumberOwnership(tenantId, PHONE_NUMBER_ID)
    ).resolves.toEqual({
      ownedByOtherTenant: true,
      activeForTenant: false,
      storedPin: null,
    })
  })

  it("no encuentra nada cuando el número no está conectado", async () => {
    await expect(
      resolveWhatsappNumberOwnership(tenantId, PHONE_NUMBER_ID)
    ).resolves.toEqual({
      ownedByOtherTenant: false,
      activeForTenant: false,
      storedPin: null,
    })
  })
})

describe("countActiveWhatsappNumbersInWaba contra Postgres", () => {
  beforeEach(async () => {
    await connectWhatsappNumber(tenantId, numberInput())
    await connectWhatsappNumber(
      otherTenantId,
      numberInput({ phoneNumberId: "209876543210987" })
    )
  })

  // El bind es un array vacío: Neon lo serializa a "{}" y el `::uuid[]` es lo
  // único que le dice a Postgres qué es. Sin ejecutarlo no hay forma de saber
  // si esa combinación se prepara.
  it("cuenta los números del WABA de todos los tenants", async () => {
    await expect(
      countActiveWhatsappNumbersInWaba({ wabaId: WABA_ID })
    ).resolves.toBe(2)
  })

  it("descuenta los que la operación en curso está dando de baja", async () => {
    const row = await one(
      `select id from connected_pages where tenant_id = $1`,
      [tenantId]
    )

    await expect(
      countActiveWhatsappNumbersInWaba({
        wabaId: WABA_ID,
        excludeConnectionIds: [String(row.id)],
      })
    ).resolves.toBe(1)
  })

  it("no cuenta los desconectados", async () => {
    await database.db.query(`update connected_pages set status = 'disconnected'`)

    await expect(
      countActiveWhatsappNumbersInWaba({ wabaId: WABA_ID })
    ).resolves.toBe(0)
  })
})

describe("getGeneratedWhatsappPin contra Postgres", () => {
  it("devuelve solo el PIN que generamos nosotros", async () => {
    const mine = await connectWhatsappNumber(tenantId, numberInput())

    await expect(getGeneratedWhatsappPin(tenantId, mine.id)).resolves.toBe(
      "042713"
    )
  })

  it("calla el PIN que aportó el cliente", async () => {
    const mine = await connectWhatsappNumber(
      tenantId,
      numberInput({ pinOrigin: "customer" })
    )

    await expect(getGeneratedWhatsappPin(tenantId, mine.id)).resolves.toBeNull()
  })

  it("no entrega el PIN de una conexión ajena", async () => {
    const theirs = await connectWhatsappNumber(otherTenantId, numberInput())

    await expect(getGeneratedWhatsappPin(tenantId, theirs.id)).resolves.toBeNull()
  })
})

function numberInput(
  overrides: Partial<WhatsappNumberInput> = {}
): WhatsappNumberInput {
  return {
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA_ID,
    wabaName: "Vetta",
    phoneE164: "+5215512345678",
    verifiedName: "Vetta Clínica",
    accessToken: "business-token",
    tokenExpiresAt: null,
    pin: "042713",
    pinOrigin: "generated",
    onboardingMode: "standard",
    ...overrides,
  }
}

async function insertTenant(email: string): Promise<string> {
  const row = await one(
    `insert into users (email, password_hash) values ($1, 'hash') returning id`,
    [email]
  )
  return String(row.id)
}

async function one(
  statement: string,
  parameters: unknown[] = []
): Promise<Record<string, unknown>> {
  const result = await database.db.query<Record<string, unknown>>(
    statement,
    parameters
  )
  const first = result.rows[0]
  if (!first) throw new Error(`sin filas: ${statement}`)
  return first
}

async function count(table: string): Promise<number> {
  const row = await one(`select count(*)::int as total from ${table}`)
  return Number(row.total)
}
