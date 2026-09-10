import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"
import { en } from "@/content/i18n/app/en"

import {
  buildFacebookLoginOptions,
  parseWhatsappMode,
  WHATSAPP_SESSION_INFO_VERSION,
  WHATSAPP_SIGNUP_FEATURE_TYPE,
} from "./signup-launch"

describe("buildFacebookLoginOptions", () => {
  it("pide un code y no un token, que es lo que nunca puede llegar al navegador", () => {
    const options = buildFacebookLoginOptions("cfg")

    expect(options.response_type).toBe("code")
    expect(options.override_default_response_type).toBe(true)
    expect(options.config_id).toBe("cfg")
  })

  it("manda sessionInfoVersion: es el session logging del que vive el cierre", () => {
    // Sin él no llegan los `postMessage` de los que `signup-events.ts` deriva el
    // modo, y Coexistence lo exige formalmente.
    expect(buildFacebookLoginOptions("cfg").extras.sessionInfoVersion).toBe(
      WHATSAPP_SESSION_INFO_VERSION
    )
  })

  it("manda version v4: es lo que genera el propio App Dashboard", () => {
    // El enlace de la landing alojada por Meta sale con
    // `extras={"version":"v4","sessionInfoVersion":"3","featureType":"..."}`.
    // v2 se deprecia el 2026-10-15, así que la versión va explícita y no al
    // default.
    expect(buildFacebookLoginOptions("cfg").extras.version).toBe("v4")
  })

  it("manda siempre el featureType, porque es aditivo y no restrictivo", () => {
    // Verificado contra el diálogo real: con el `featureType` puesto el
    // desplegable ofrece las tres opciones —cuenta nueva, «Conecta una
    // aplicación de WhatsApp Business» y las WABAs del portafolio—. Sin él,
    // Coexistence no aparece y el usuario no puede conectar el número que ya
    // usa. Por eso hay un solo botón y estas opciones son las únicas.
    expect(buildFacebookLoginOptions("cfg").extras.featureType).toBe(
      WHATSAPP_SIGNUP_FEATURE_TYPE
    )
  })

  it("manda setup vacío: los permisos viven en el Configuration ID", () => {
    expect(buildFacebookLoginOptions("cfg").extras.setup).toEqual({})
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

describe("el copy del único punto de entrada", () => {
  it("antes del clic avisa de que la elección de adentro tiene consecuencias", () => {
    expect(es.whatsappSignup.connect).toBe("Conectar WhatsApp")
    // No se puede prometer una consecuencia concreta antes de que el usuario
    // elija dentro del diálogo, pero sí decir que hay elección y que no da
    // lo mismo cuál.
    expect(es.whatsappSignup.description).toMatch(/eliges|elijas/)
    expect(es.whatsappSignup.description).toMatch(/no da lo mismo/i)
  })

  it("cada modo tiene su advertencia, para decirla al cerrarse la ventana", () => {
    // Estándar: lo que se pierde. Coexistence: el techo y el reloj.
    expect(es.connections.whatsappModeCaveat.standard).toContain(
      "deja de poder usarse desde la app de WhatsApp Business"
    )
    expect(es.connections.whatsappModeCaveat.coexistence).toContain(
      "20 mensajes por segundo"
    )
    expect(es.connections.whatsappModeCaveat.coexistence).toContain("24 horas")
  })
})

describe("el mismo copy en inglés", () => {
  it("dice la elección antes del clic y la consecuencia después", () => {
    expect(en.whatsappSignup.connect).toBe("Connect WhatsApp")
    expect(en.whatsappSignup.description).toMatch(/choose/i)
    // Los dos datos duros de Coexistence sobreviven a la traducción: son el
    // techo y el reloj, y quien no los lee se entera cuando ya es tarde.
    expect(en.connections.whatsappModeCaveat.coexistence).toContain(
      "20 messages per second"
    )
    expect(en.connections.whatsappModeCaveat.coexistence).toContain("24 hours")
    expect(en.connections.whatsappModeCaveat.standard).toContain(
      "can no longer be used from the WhatsApp Business app"
    )
  })
})
