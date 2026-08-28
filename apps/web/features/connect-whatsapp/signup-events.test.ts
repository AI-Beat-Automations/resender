import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"

import {
  describeWhatsappSignupEvent,
  readWhatsappSignupEvent,
  resolveWhatsappOnboardingMode,
  WHATSAPP_SIGNUP_ALLOWED_ORIGINS,
  type WhatsappSignupMessage,
} from "./signup-events"

// Un `postMessage` como los que manda Meta: `data` es un string JSON y el
// origen es uno de los permitidos, salvo que el test diga otra cosa.
const message = (
  data: unknown,
  overrides: Partial<WhatsappSignupMessage> = {}
): WhatsappSignupMessage => ({
  isTrusted: true,
  origin: WHATSAPP_SIGNUP_ALLOWED_ORIGINS[0],
  data: typeof data === "string" ? data : JSON.stringify(data),
  ...overrides,
})

const finish = (payload: Record<string, unknown>, event = "FINISH") =>
  message({ type: "WA_EMBEDDED_SIGNUP", event, data: payload })

describe("readWhatsappSignupEvent — el borde no confiable", () => {
  it("ignora un evento fabricado por un script de la propia página", () => {
    // `isTrusted: false` es lo único que separa un `dispatchEvent` de una
    // extensión de un mensaje real del popup.
    expect(
      readWhatsappSignupEvent({
        ...finish({ waba_id: "1", phone_number_id: "2" }),
        isTrusted: false,
      })
    ).toBeNull()
  })

  it("rechaza un origen que solo termina en facebook.com", () => {
    // La documentación de Meta publica `origin.endsWith('facebook.com')`, y eso
    // acepta este dominio. La lista cerrada no.
    const result = readWhatsappSignupEvent({
      ...finish({ waba_id: "1", phone_number_id: "2" }),
      origin: "https://evilfacebook.com",
    })

    expect(result).toEqual({
      kind: "foreign-origin",
      origin: "https://evilfacebook.com",
    })
  })

  it("acepta los tres orígenes de la allowlist", () => {
    for (const origin of WHATSAPP_SIGNUP_ALLOWED_ORIGINS) {
      const result = readWhatsappSignupEvent({
        ...finish({ waba_id: "1", phone_number_id: "2" }),
        origin,
      })
      expect(result?.kind).toBe("finished")
    }
  })

  it("ignora sin ruido lo que no dice ser de Embedded Signup", () => {
    expect(
      readWhatsappSignupEvent(message({ type: "OTHER", event: "FINISH" }))
    ).toBeNull()
    expect(readWhatsappSignupEvent(message("no soy json"))).toBeNull()
    expect(readWhatsappSignupEvent(message([1, 2, 3]))).toBeNull()
    expect(
      readWhatsappSignupEvent(message({ type: "WA_EMBEDDED_SIGNUP" }))
    ).toBeNull()
  })

  it("mira el origen después del tipo, para no reportar ruido ajeno", () => {
    // Un widget cualquiera desde otro origen no tiene que aparecer como
    // `foreign-origin`: eso ahogaría el aviso que sí importa.
    expect(
      readWhatsappSignupEvent({
        ...message({ type: "OTHER", event: "FINISH" }),
        origin: "https://ads.example",
      })
    ).toBeNull()
  })

  it("acepta un objeto ya deserializado y un id numérico", () => {
    const result = readWhatsappSignupEvent({
      isTrusted: true,
      origin: WHATSAPP_SIGNUP_ALLOWED_ORIGINS[0],
      data: {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: 524126980791429, phone_number_id: "109" },
      },
    })

    expect(result).toEqual({
      kind: "finished",
      mode: "standard",
      assets: {
        wabaId: "524126980791429",
        phoneNumberId: "109",
        businessId: null,
      },
    })
  })
})

describe("readWhatsappSignupEvent — los desenlaces", () => {
  it("clasifica el cierre feliz del flujo estándar", () => {
    expect(
      readWhatsappSignupEvent(
        finish({ waba_id: "10", phone_number_id: "20", business_id: "30" })
      )
    ).toEqual({
      kind: "finished",
      mode: "standard",
      assets: { wabaId: "10", phoneNumberId: "20", businessId: "30" },
    })
  })

  it("trata un FINISH estándar sin número como un alta sin teléfono", () => {
    expect(readWhatsappSignupEvent(finish({ waba_id: "10" }))).toEqual({
      kind: "finished-without-number",
    })
  })

  it("exige el waba_id: sin él no hay nada que confirmar contra Graph", () => {
    expect(readWhatsappSignupEvent(finish({ phone_number_id: "20" }))).toEqual({
      kind: "malformed",
    })
  })

  it("distingue el abandono del error reportado, que comparten CANCEL", () => {
    expect(
      readWhatsappSignupEvent(
        finish({ current_step: "PHONE_NUMBER_SETUP" }, "CANCEL")
      )
    ).toEqual({ kind: "abandoned", currentStep: "PHONE_NUMBER_SETUP" })

    expect(
      readWhatsappSignupEvent(
        finish(
          {
            error_message: "algo salió mal",
            error_code: "1234",
            session_id: "s1",
          },
          "CANCEL"
        )
      )
    ).toEqual({
      kind: "reported-error",
      errorMessage: "algo salió mal",
      errorCode: "1234",
      sessionId: "s1",
    })
  })

  it("reporta un FINISH* nuevo como flujo no soportado, no como silencio", () => {
    expect(readWhatsappSignupEvent(finish({}, "FINISH_OBO_MIGRATION"))).toEqual(
      { kind: "unsupported-flow", event: "FINISH_OBO_MIGRATION" }
    )
    expect(readWhatsappSignupEvent(finish({}, "FINISH_ALGO_NUEVO"))).toEqual({
      kind: "unsupported-flow",
      event: "FINISH_ALGO_NUEVO",
    })
  })
})

describe("readWhatsappSignupEvent — el modo sale del evento de cierre", () => {
  // Es **la** regla de seguridad del launcher. El botón es uno solo y las
  // opciones de `FB.login` son las mismas para los dos flujos: quién elige es el
  // usuario, dentro del diálogo de Meta. Si el modo se supusiera desde el botón,
  // un cierre de Coexistence tomado por estándar terminaría en `/register`, que
  // desvincula el número de la app de WhatsApp Business y no se deshace.
  it("deriva standard del FINISH del flujo estándar", () => {
    expect(resolveWhatsappOnboardingMode("FINISH")).toBe("standard")
    expect(
      readWhatsappSignupEvent(finish({ waba_id: "10", phone_number_id: "20" }))
    ).toEqual({
      kind: "finished",
      mode: "standard",
      assets: { wabaId: "10", phoneNumberId: "20", businessId: null },
    })
  })

  it("deriva coexistence del FINISH de Business App onboarding", () => {
    expect(
      resolveWhatsappOnboardingMode("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
    ).toBe("coexistence")
    expect(
      readWhatsappSignupEvent(
        finish(
          { waba_id: "10", phone_number_id: "20" },
          "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
        )
      )
    ).toEqual({
      kind: "finished",
      mode: "coexistence",
      assets: { wabaId: "10", phoneNumberId: "20", businessId: null },
    })
  })

  it("no deriva ningún modo de un FINISH* desconocido", () => {
    // Registrar un número adivinando el flujo es exactamente lo que no puede
    // pasar: sin modo derivado, el cierre no se envía y se le cuenta al usuario.
    for (const event of [
      "FINISH_ONLY_WABA",
      "FINISH_OBO_MIGRATION",
      "FINISH_GRANT_ONLY_API_ACCESS",
      "FINISH_ALGO_NUEVO",
      "CANCEL",
    ]) {
      expect(resolveWhatsappOnboardingMode(event)).toBeNull()
    }
  })

  it("deja seguir Coexistence sin phone_number_id: Graph sabe cuál es", () => {
    // El número ya existe en la app de WhatsApp Business, así que el servidor
    // lo resuelve por `is_on_biz_app` aunque el popup no lo reporte. En el
    // estándar la misma ausencia sí corta: ahí el alta del teléfono es el paso
    // que el usuario se saltó.
    expect(
      readWhatsappSignupEvent(
        finish({ waba_id: "10" }, "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
      )
    ).toEqual({
      kind: "finished",
      mode: "coexistence",
      assets: { wabaId: "10", phoneNumberId: null, businessId: null },
    })
  })
})

describe("describeWhatsappSignupEvent", () => {
  it("calla en los dos casos que no son un mensaje para el usuario", () => {
    expect(
      describeWhatsappSignupEvent(
        {
          kind: "finished",
          mode: "standard",
          assets: { wabaId: "1", phoneNumberId: "2", businessId: null },
        },
        es
      )
    ).toBeNull()
    expect(
      describeWhatsappSignupEvent({ kind: "foreign-origin", origin: "x" }, es)
    ).toBeNull()
  })

  it("no manda a ningún otro botón: los dos cierres soportados no llegan acá", () => {
    // Con un solo punto de entrada, `FINISH` y
    // `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` son los dos desenlaces válidos
    // del mismo botón. Un texto que mandara «al otro botón» hablaría de una
    // pantalla que ya no existe.
    for (const event of ["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]) {
      expect(resolveWhatsappOnboardingMode(event)).not.toBeNull()
    }
  })

  it("no dice «error» cuando el usuario terminó bien por otra variante", () => {
    const message = describeWhatsappSignupEvent(
      {
        kind: "unsupported-flow",
        event: "FINISH_OBO_MIGRATION",
      },
      es
    )

    expect(message).not.toMatch(/error/i)
  })

  it("nombra el paso donde el usuario cerró, y lo omite si no lo conoce", () => {
    expect(
      describeWhatsappSignupEvent(
        {
          kind: "abandoned",
          currentStep: "PHONE_NUMBER_VERIFICATION",
        },
        es
      )
    ).toContain("la verificación del número")

    expect(
      describeWhatsappSignupEvent(
        {
          kind: "abandoned",
          currentStep: "PASO_NUEVO",
        },
        es
      )
    ).not.toContain("PASO_NUEVO")
  })

  it("cita el código y la sesión del error que reportó Meta", () => {
    expect(
      describeWhatsappSignupEvent(
        {
          kind: "reported-error",
          errorMessage: "no elegible",
          errorCode: "42",
          sessionId: "s9",
        },
        es
      )
    ).toBe(
      "Meta rechazó la conexión: no elegible (código 42 · sesión s9 — cítalos si escribes a soporte)."
    )
  })
})
