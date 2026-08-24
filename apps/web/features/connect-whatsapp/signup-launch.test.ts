import { describe, expect, it } from "vitest"

import {
  buildFacebookLoginOptions,
  parseWhatsappMode,
  resolveWhatsappConfigId,
  WHATSAPP_COEXISTENCE_FEATURE_TYPE,
  WHATSAPP_ENTRY_POINTS,
  WHATSAPP_SESSION_INFO_VERSION,
} from "./signup-launch"

describe("buildFacebookLoginOptions", () => {
  it("pide un code y no un token, que es lo que nunca puede llegar al navegador", () => {
    const options = buildFacebookLoginOptions("cfg", "standard")

    expect(options.response_type).toBe("code")
    expect(options.override_default_response_type).toBe(true)
  })

  it("manda sessionInfoVersion en los dos flujos: es el session logging", () => {
    // Sin él no llegan los `postMessage` de los que vive `signup-events.ts`, y
    // Coexistence lo exige formalmente.
    for (const mode of ["standard", "coexistence"] as const) {
      expect(
        buildFacebookLoginOptions("cfg", mode).extras.sessionInfoVersion
      ).toBe(WHATSAPP_SESSION_INFO_VERSION)
    }
  })

  it("solo Coexistence lleva featureType", () => {
    expect(
      buildFacebookLoginOptions("cfg", "standard").extras.featureType
    ).toBeUndefined()
    expect(
      buildFacebookLoginOptions("cfg", "coexistence").extras.featureType
    ).toBe(WHATSAPP_COEXISTENCE_FEATURE_TYPE)
  })

  it("manda setup vacío: los permisos viven en el Configuration ID", () => {
    expect(buildFacebookLoginOptions("cfg", "standard").extras.setup).toEqual(
      {}
    )
  })
})

describe("resolveWhatsappConfigId", () => {
  it("usa la configuración propia de Coexistence cuando el despliegue la tiene", () => {
    expect(
      resolveWhatsappConfigId(
        { configId: "std", coexistenceConfigId: "coex" },
        "coexistence"
      )
    ).toBe("coex")
  })

  it("cae en la configuración estándar cuando no hay una aparte", () => {
    expect(
      resolveWhatsappConfigId(
        { configId: "std", coexistenceConfigId: null },
        "coexistence"
      )
    ).toBe("std")
    expect(
      resolveWhatsappConfigId(
        { configId: "std", coexistenceConfigId: "coex" },
        "standard"
      )
    ).toBe("std")
  })

  it("devuelve null cuando el despliegue no está configurado", () => {
    expect(
      resolveWhatsappConfigId(
        { configId: null, coexistenceConfigId: null },
        "standard"
      )
    ).toBeNull()
  })
})

describe("parseWhatsappMode", () => {
  it("solo el valor exacto abre Coexistence", () => {
    expect(parseWhatsappMode("coexistence")).toBe("coexistence")
    expect(parseWhatsappMode("Coexistence")).toBe("standard")
    expect(parseWhatsappMode("standard")).toBe("standard")
    expect(parseWhatsappMode(null)).toBe("standard")
    expect(parseWhatsappMode(undefined)).toBe("standard")
    expect(parseWhatsappMode(["coexistence"])).toBe("standard")
  })
})

describe("WHATSAPP_ENTRY_POINTS", () => {
  it("son dos, con copy distinto, y dicen la consecuencia antes de lanzarse", () => {
    expect(WHATSAPP_ENTRY_POINTS).toHaveLength(2)
    expect(WHATSAPP_ENTRY_POINTS.map((entry) => entry.mode)).toEqual([
      "standard",
      "coexistence",
    ])

    const labels = new Set(WHATSAPP_ENTRY_POINTS.map((entry) => entry.label))
    expect(labels.size).toBe(2)

    for (const entry of WHATSAPP_ENTRY_POINTS) {
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.caveat.length).toBeGreaterThan(0)
    }
  })

  it("avisa del plazo de 24 horas en el flujo que lo tiene", () => {
    const coexistence = WHATSAPP_ENTRY_POINTS.find(
      (entry) => entry.mode === "coexistence"
    )

    expect(coexistence?.caveat).toContain("24 horas")
  })
})
