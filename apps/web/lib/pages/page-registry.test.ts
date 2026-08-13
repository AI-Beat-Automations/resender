import { beforeEach, describe, expect, it, vi } from "vitest"

// El registro de cuentas conectadas habla con Postgres, así que acá se le pone
// un `sql` de mentira: un tag de plantilla que anota la consulta y devuelve —o
// lanza— lo que la prueba encoló. No es un Postgres de juguete y no pretende
// serlo; lo que se está fijando es lo que decide el comportamiento y no se ve en
// ningún otro sitio: **por qué se filtra cada consulta** (o por qué no) y cómo
// se traduce el error que devuelve la base cuando se pierde una carrera.

type RecordedQuery = { text: string; params: unknown[] }

const queries: RecordedQuery[] = []
let responses: unknown[] = []

function enqueue(...values: unknown[]) {
  responses = values
}

const sql = Object.assign(
  (strings: TemplateStringsArray, ...params: unknown[]) => {
    queries.push({ text: strings.join(" ? "), params })
    const next = responses.shift()
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next ?? [])
  },
  { transaction: vi.fn() }
)

vi.mock("@/lib/db", () => ({
  getSql: () => sql,
}))

// Cifrado de mentira, reversible y visible: lo que importa es **qué** se cifra y
// **cuándo** se descifra, no el algoritmo (que tiene sus propias pruebas).
vi.mock("@/lib/crypto/encryption", () => ({
  encryptSecret: (value: string) => `enc(${value})`,
  decryptSecret: (value: string) => value.replace(/^enc\(|\)$/g, ""),
}))

import {
  connectWhatsappNumber,
  countActiveWhatsappNumbersInWaba,
  getGeneratedWhatsappPin,
  listTenantPages,
  PageOwnershipError,
  resolveWhatsappNumberOwnership,
  type WhatsappNumberInput,
} from "./page-registry"

const PHONE_NUMBER_ID = "109876543210987"
const WABA_ID = "102030405060708"

const numberInput = (
  overrides: Partial<WhatsappNumberInput> = {}
): WhatsappNumberInput => ({
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
})

const writtenRow = {
  id: "connection-1",
  tenant_id: "tenant-1",
  channel: "whatsapp",
  meta_page_id: PHONE_NUMBER_ID,
  name: "Vetta Clínica",
  username: null,
  status: "active",
  token_status: "valid",
  token_error: null,
  token_error_at: null,
  token_expires_at: null,
  waba_id: WABA_ID,
  whatsapp_phone_e164: "+5215512345678",
  webhook_url: null,
  connected_at: new Date("2026-08-13T00:00:00.000Z"),
  disconnected_at: null,
  created_at: new Date("2026-08-13T00:00:00.000Z"),
  updated_at: new Date("2026-08-13T00:00:00.000Z"),
}

beforeEach(() => {
  queries.length = 0
  responses = []
})

describe("connectWhatsappNumber", () => {
  // La carrera que la base sí aguanta y el mensaje no. Entre el `select` de
  // propiedad y el insert hay una ventana —el driver HTTP de Neon no da
  // transacciones interactivas—, y dos tenants que conectan el mismo número a la
  // vez la atraviesan los dos. El perdedor chocaba contra el unique de la 0013 y
  // recibía «no se pudo guardar, vuelve a intentarlo»: un error reintentable que
  // no va a funcionar nunca, en lugar de la verdad.
  it("turns the unique violation of a lost race into the ownership error", async () => {
    const uniqueViolation = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      { code: "23505" }
    )
    // El `select` no ve nada (el otro tenant todavía no había commiteado) y el
    // insert choca.
    enqueue([], uniqueViolation)

    const thrown = await connectWhatsappNumber("tenant-1", numberInput()).catch(
      (error: unknown) => error
    )

    expect(thrown).toBeInstanceOf(PageOwnershipError)
    // El mismo error del camino comprobado, con el número dentro: para el
    // llamador el desenlace es idéntico gane o pierda la carrera, así que el
    // mismo problema no tiene dos redacciones.
    expect(thrown).toMatchObject({ metaPageId: PHONE_NUMBER_ID })
  })

  it("does not swallow any other database error", async () => {
    enqueue([], new Error("connection terminated unexpectedly"))

    await expect(connectWhatsappNumber("tenant-1", numberInput())).rejects.toThrow(
      "connection terminated unexpectedly"
    )
  })

  // El veredicto del camino comprobado sigue igual: si la fila es de otro
  // tenant, no se escribe nada.
  it("refuses a number that already belongs to another tenant, without writing", async () => {
    enqueue([{ id: "connection-9", tenant_id: "tenant-2" }])

    await expect(
      connectWhatsappNumber("tenant-1", numberInput())
    ).rejects.toBeInstanceOf(PageOwnershipError)
    expect(queries).toHaveLength(1)
  })

  // El origen del PIN es el bit que distingue «se lo creamos nosotros» de «lo
  // aportó él», y es lo único que decide si la tarjeta de Conexiones se lo
  // enseña. En un alta se guarda tal cual.
  it("marks a generated PIN as ours when the number is new", async () => {
    enqueue([], [writtenRow])

    await connectWhatsappNumber("tenant-1", numberInput())

    const insert = queries[1]
    expect(insert?.text).toContain("whatsapp_pin_generated")
    expect(insert?.params).toContain("enc(042713)")
    expect(insert?.params).toContain(true)
  })

  it("marks a PIN typed by the customer as theirs", async () => {
    enqueue([], [writtenRow])

    await connectWhatsappNumber(
      "tenant-1",
      numberInput({ pinOrigin: "customer" })
    )

    expect(queries[1]?.params).toContain(false)
  })

  // Reconexión con el PIN guardado: la marca **no se toca**. Pisarla con `false`
  // solo porque este intento no generó el PIN lo escondería de la tarjeta a
  // partir de la segunda conexión, que es justo cuando el cliente lo necesita.
  it("leaves the origin alone when a reconnection reuses the stored PIN", async () => {
    enqueue([{ id: "connection-1", tenant_id: "tenant-1" }], [writtenRow])

    await connectWhatsappNumber("tenant-1", numberInput({ pinOrigin: "stored" }))

    const update = queries[1]
    expect(update?.text).toContain("coalesce")
    // `null` es lo que hace que el `coalesce` conserve el valor de la fila.
    expect(update?.params).toContain(null)
    expect(update?.params).not.toContain(true)
    expect(update?.params).not.toContain(false)
  })
})

describe("resolveWhatsappNumberOwnership", () => {
  // Sin filtrar por tenant a propósito: la pregunta es «¿de quién es este
  // número?», y una consulta que solo mire las filas propias contesta «de nadie»
  // justo en el caso que hay que detener antes de llamar a Meta.
  it("looks the number up across every tenant", async () => {
    enqueue([])

    await resolveWhatsappNumberOwnership("tenant-1", PHONE_NUMBER_ID)

    expect(queries[0]?.params).toEqual([PHONE_NUMBER_ID])
    expect(queries[0]?.text).not.toContain("tenant_id =")
    // Ni por estado: una conexión desconectada sigue registrada en Meta con su
    // PIN, y sigue siendo de su dueño.
    expect(queries[0]?.text).not.toContain("status =")
  })

  it("reports a number owned by another tenant and never decrypts its PIN", async () => {
    enqueue([
      {
        tenant_id: "tenant-2",
        status: "active",
        whatsapp_pin_encrypted: "enc(999999)",
      },
    ])

    await expect(
      resolveWhatsappNumberOwnership("tenant-1", PHONE_NUMBER_ID)
    ).resolves.toEqual({
      ownedByOtherTenant: true,
      activeForTenant: false,
      // El secreto de un tercero no sale de la base para contestar de quién es
      // el número.
      storedPin: null,
    })
  })

  it("hands back the tenant's own PIN so a reconnection can re-register", async () => {
    enqueue([
      {
        tenant_id: "tenant-1",
        status: "active",
        whatsapp_pin_encrypted: "enc(042713)",
      },
    ])

    await expect(
      resolveWhatsappNumberOwnership("tenant-1", PHONE_NUMBER_ID)
    ).resolves.toEqual({
      ownedByOtherTenant: false,
      activeForTenant: true,
      storedPin: "042713",
    })
  })

  it("says a disconnected number of this tenant does not occupy a slot", async () => {
    enqueue([
      {
        tenant_id: "tenant-1",
        status: "disconnected",
        whatsapp_pin_encrypted: null,
      },
    ])

    await expect(
      resolveWhatsappNumberOwnership("tenant-1", PHONE_NUMBER_ID)
    ).resolves.toEqual({
      ownedByOtherTenant: false,
      activeForTenant: false,
      storedPin: null,
    })
  })

  it("treats an unknown number as free", async () => {
    enqueue([])

    await expect(
      resolveWhatsappNumberOwnership("tenant-1", PHONE_NUMBER_ID)
    ).resolves.toEqual({
      ownedByOtherTenant: false,
      activeForTenant: false,
      storedPin: null,
    })
  })
})

describe("countActiveWhatsappNumbersInWaba", () => {
  // **Todos los tenants**, igual que arriba y por el mismo motivo: la
  // suscripción cuelga del WABA y el WABA es compartido, así que desuscribirlo
  // apaga los webhooks de los números de cualquier cuenta de Resender que
  // cuelgue de él. Filtrar por tenant reproduciría el bug entre cuentas.
  it("counts across every tenant, excluding the connections going away", async () => {
    enqueue([{ count: 2 }])

    await expect(
      countActiveWhatsappNumbersInWaba({
        wabaId: WABA_ID,
        excludeConnectionIds: ["connection-1"],
      })
    ).resolves.toBe(2)

    expect(queries[0]?.text).not.toContain("tenant_id")
    expect(queries[0]?.params).toEqual([WABA_ID, ["connection-1"]])
  })

  it("defaults to excluding nothing", async () => {
    enqueue([{ count: 0 }])

    await expect(
      countActiveWhatsappNumbersInWaba({ wabaId: WABA_ID })
    ).resolves.toBe(0)

    expect(queries[0]?.params).toEqual([WABA_ID, []])
  })
})

describe("getGeneratedWhatsappPin", () => {
  it("only returns a PIN of this tenant that we generated ourselves", async () => {
    enqueue([{ whatsapp_pin_encrypted: "enc(042713)" }])

    await expect(getGeneratedWhatsappPin("tenant-1", "connection-1")).resolves.toBe(
      "042713"
    )

    expect(queries[0]?.params).toEqual(["connection-1", "tenant-1"])
    expect(queries[0]?.text).toContain("whatsapp_pin_generated")
  })

  it("returns null when there is nothing of ours to hand back", async () => {
    enqueue([])

    await expect(
      getGeneratedWhatsappPin("tenant-1", "connection-1")
    ).resolves.toBeNull()
  })
})

describe("listTenantPages", () => {
  // La pantalla necesita saber si hay un PIN que enseñar, pero el PIN no puede
  // viajar en el render de cada tarjeta: lo que se proyecta es el booleano, y el
  // valor se pide con una acción aparte.
  it("projects whether there is a PIN of ours, never the PIN itself", async () => {
    enqueue([{ ...writtenRow, has_generated_whatsapp_pin: true }])

    const [page] = await listTenantPages("tenant-1")

    expect(page?.hasGeneratedWhatsappPin).toBe(true)
    expect(queries[0]?.text).not.toContain("whatsapp_pin_encrypted as")
    expect(JSON.stringify(page)).not.toContain("042713")
  })

  it("treats a row without the flag as nothing to show", async () => {
    enqueue([{ ...writtenRow, has_generated_whatsapp_pin: false }])

    const [page] = await listTenantPages("tenant-1")

    expect(page?.hasGeneratedWhatsappPin).toBe(false)
  })
})
