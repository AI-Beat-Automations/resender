import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock("@/lib/db", () => ({ getSql: () => sqlMock }))

import {
  getWhatsappTemplate,
  normalizeWhatsappTemplateCategory,
  normalizeWhatsappTemplateLanguage,
  normalizeWhatsappTemplateStatus,
  updateWhatsappTemplateStatus,
} from "./template-registry"

// La última consulta que se le pidió al driver, con el SQL en una sola línea
// para poder afirmar sobre la sentencia sin pelearse con la indentación del
// template. Mismo doble que `lib/account/media-purge.test.ts`.
function lastQuery(): { text: string; params: unknown[] } {
  const call = sqlMock.mock.calls.at(-1)
  const [strings, ...params] = call as [TemplateStringsArray, ...unknown[]]
  return { text: strings.join(" ? ").replace(/\s+/g, " ").trim(), params }
}

const WABA_ID = "102290129340398"

// No hay base de datos acá —ni la va a haber: fuera de
// `db/migrations/migrations.test.ts` la app web no tiene tests de integración
// contra Postgres, y el SQL se verifica a mano en preview—. Lo que sí se prueba
// es lo que decide **qué fila** se toca, que es el único error de este módulo
// que no se ve: una clave mal armada no falla, simplemente no encuentra nada.
describe("normalización del status de plantilla", () => {
  it("reconoce el catálogo de Meta tal cual llega", () => {
    expect(normalizeWhatsappTemplateStatus("APPROVED")).toBe("APPROVED")
    expect(normalizeWhatsappTemplateStatus("PENDING_DELETION")).toBe(
      "PENDING_DELETION"
    )
    // Los dos nombres del mismo hecho, que la doc de Meta usa según la página.
    expect(normalizeWhatsappTemplateStatus("PENDING")).toBe("PENDING")
    expect(normalizeWhatsappTemplateStatus("IN_REVIEW")).toBe("IN_REVIEW")
    // No está en la lista canónica de Meta y existe igual: es la razón por la
    // que la columna no lleva check (0018 §3).
    expect(normalizeWhatsappTemplateStatus("LIMIT_EXCEEDED")).toBe(
      "LIMIT_EXCEEDED"
    )
  })

  it("no se pierde por mayúsculas ni espacios", () => {
    expect(normalizeWhatsappTemplateStatus(" approved ")).toBe("APPROVED")
  })

  // Meta agrega estados sin cambiar de versión de API. Lo que no reconocemos
  // no se envía, pero tampoco se descarta: el string literal se conserva en
  // `rawStatus` para poder medir qué está llegando antes de modelarlo.
  it("manda a unknown lo que no reconoce, incluida la cadena vacía", () => {
    expect(normalizeWhatsappTemplateStatus("SOMETHING_NEW")).toBe("unknown")
    expect(normalizeWhatsappTemplateStatus("")).toBe("unknown")
    // Nada que no sea exactamente `APPROVED` puede caer en aprobado.
    expect(normalizeWhatsappTemplateStatus("APPROVED_WITH_WARNINGS")).toBe(
      "unknown"
    )
  })
})

// El idioma es el único tercio de la clave que Meta escribe de dos maneras, y
// la única prueba que vale acá es la de la clave: no que la función devuelva
// tal string, sino que las dos formas terminen preguntando por **la misma
// fila**. Es lo que impide que el sync y el webhook escriban en dos filas
// distintas para la misma plantilla, y lo que se rompe callado si alguien
// mueve la normalización a los llamadores.
describe("el idioma canónico de la clave del espejo", () => {
  beforeEach(() => sqlMock.mockReset().mockResolvedValue([]))

  it("resuelve la misma fila con guion y con guion bajo", async () => {
    await getWhatsappTemplate({
      wabaId: WABA_ID,
      name: "order_confirmation",
      language: "en-US",
    })
    const hyphen = lastQuery()

    await getWhatsappTemplate({
      wabaId: WABA_ID,
      name: "order_confirmation",
      language: "en_US",
    })
    const underscore = lastQuery()

    expect(hyphen).toEqual(underscore)
    // La forma canónica es la de guion bajo: la que devuelve el catálogo de
    // Graph y la que acepta `template.language.code` al enviar.
    expect(underscore.params).toEqual([WABA_ID, "order_confirmation", "en_US"])
  })

  // El webhook trae el estado y el sync trae la fila, así que si la escritura
  // no normalizara igual que la lectura el `update` no encontraría nada y el
  // espejo se congelaría sin un solo error.
  it("normaliza también al escribir, no sólo al leer", async () => {
    await updateWhatsappTemplateStatus({
      wabaId: WABA_ID,
      name: "order_confirmation",
      language: "en-US",
      status: "APPROVED",
    })

    expect(lastQuery().params).toContain("en_US")
  })

  it("canoniza la región y deja en paz lo que no es un código de idioma", () => {
    expect(normalizeWhatsappTemplateLanguage("pt-br")).toBe("pt_BR")
    expect(normalizeWhatsappTemplateLanguage(" es ")).toBe("es")
    // Un valor que no tiene forma de código no se toca más allá del separador:
    // inventar sobre lo que no entendemos es la otra manera de perder la fila.
    expect(normalizeWhatsappTemplateLanguage("Portuguese")).toBe("Portuguese")
  })
})

// Meta nombra las categorías en mayúsculas y el check de la 0018 las guarda en
// minúsculas: sin esta traducción el `update` del webhook rompería contra la
// restricción y se llevaría el lote entero.
describe("normalización de la categoría", () => {
  it("traduce el vocabulario de Meta al de la columna", () => {
    expect(normalizeWhatsappTemplateCategory("UTILITY")).toBe("utility")
    expect(normalizeWhatsappTemplateCategory("marketing")).toBe("marketing")
  })

  it("devuelve null para lo que no está en el check, ausencia incluida", () => {
    expect(normalizeWhatsappTemplateCategory("OTP")).toBeNull()
    expect(normalizeWhatsappTemplateCategory(null)).toBeNull()
  })
})
