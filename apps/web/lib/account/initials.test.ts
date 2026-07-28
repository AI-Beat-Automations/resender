import { describe, it, expect } from "vitest"

import { initialsFromEmail } from "@/lib/account/initials"

describe("initialsFromEmail", () => {
  it("toma las dos primeras letras cuando no hay separadores", () => {
    expect(initialsFromEmail("arturo@aibeat.dev")).toBe("AR")
  })

  it("usa la inicial de los dos primeros segmentos con punto", () => {
    expect(initialsFromEmail("arturo.guerrero@aibeat.dev")).toBe("AG")
  })

  it("acepta guion bajo, guion y más como separadores", () => {
    expect(initialsFromEmail("arturo_guerrero@x.dev")).toBe("AG")
    expect(initialsFromEmail("arturo-guerrero@x.dev")).toBe("AG")
    expect(initialsFromEmail("arturo+guerrero@x.dev")).toBe("AG")
  })

  it("ignora segmentos vacíos por separadores repetidos o al inicio", () => {
    expect(initialsFromEmail(".arturo..guerrero@x.dev")).toBe("AG")
  })

  it("cae a las dos primeras letras si solo hay un segmento no vacío", () => {
    expect(initialsFromEmail("arturo.@x.dev")).toBe("AR")
  })

  it("devuelve una sola letra cuando la parte local tiene una sola letra", () => {
    expect(initialsFromEmail("a@x.dev")).toBe("A")
  })

  it("siempre devuelve mayúsculas", () => {
    expect(initialsFromEmail("Ana.perez@x.dev")).toBe("AP")
  })

  it("devuelve ? cuando no se puede derivar nada", () => {
    expect(initialsFromEmail("")).toBe("?")
    expect(initialsFromEmail("@x.dev")).toBe("?")
    expect(initialsFromEmail("..@x.dev")).toBe("?")
  })
})
