import { describe, expect, it } from "vitest"

import {
  describeWhatsappSignupEvent,
  readWhatsappSignupEvent,
  WHATSAPP_SIGNUP_ALLOWED_ORIGINS,
  type WhatsappSignupMessage,
} from "./signup-events"

// Un `postMessage` como el que manda Meta: `data` es un string JSON y el evento
// es de verdad (`isTrusted`). Cada test cambia solo lo que le importa.
function message(
  payload: unknown,
  overrides: Partial<WhatsappSignupMessage> = {}
): WhatsappSignupMessage {
  return {
    isTrusted: true,
    origin: "https://www.facebook.com",
    data: typeof payload === "string" ? payload : JSON.stringify(payload),
    ...overrides,
  }
}

const FINISH_PAYLOAD = {
  data: {
    phone_number_id: "106540352242922",
    waba_id: "524126980791429",
    business_id: "2729063490586005",
  },
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH",
}

describe("readWhatsappSignupEvent — validación del mensaje", () => {
  it("reads the standard FINISH payload published by Meta", () => {
    expect(readWhatsappSignupEvent(message(FINISH_PAYLOAD))).toEqual({
      kind: "finished",
      assets: {
        wabaId: "524126980791429",
        phoneNumberId: "106540352242922",
        businessId: "2729063490586005",
      },
    })
  })

  it("accepts every origin in the allowlist", () => {
    for (const origin of WHATSAPP_SIGNUP_ALLOWED_ORIGINS) {
      expect(
        readWhatsappSignupEvent(message(FINISH_PAYLOAD, { origin }))
      ).toMatchObject({ kind: "finished" })
    }
  })

  // La razón de ser de la allowlist: el ejemplo de Meta usa
  // `origin.endsWith('facebook.com')` y este origen lo pasaría.
  it("rejects a look-alike origin that would pass Meta's endsWith example", () => {
    expect(
      readWhatsappSignupEvent(
        message(FINISH_PAYLOAD, { origin: "https://evilfacebook.com" })
      )
    ).toEqual({ kind: "foreign-origin", origin: "https://evilfacebook.com" })
  })

  it("rejects a subdomain and the http scheme of an allowed host", () => {
    for (const origin of [
      "https://www.facebook.com.evil.example",
      "http://www.facebook.com",
      "https://facebook.com",
    ]) {
      expect(
        readWhatsappSignupEvent(message(FINISH_PAYLOAD, { origin }))
      ).toEqual({ kind: "foreign-origin", origin })
    }
  })

  it("ignores untrusted events even from an allowed origin", () => {
    expect(
      readWhatsappSignupEvent(message(FINISH_PAYLOAD, { isTrusted: false }))
    ).toBeNull()
  })

  // El origen ajeno solo se reporta si el mensaje decía ser de Embedded Signup:
  // así el aviso de QA no se ahoga entre el ruido del resto de la página.
  it("stays quiet about foreign origins that are not signup messages", () => {
    expect(
      readWhatsappSignupEvent(
        message({ type: "SOMETHING_ELSE" }, { origin: "https://evil.example" })
      )
    ).toBeNull()
  })

  it("ignores payloads that are not JSON, not objects or not ours", () => {
    expect(readWhatsappSignupEvent(message("no soy json"))).toBeNull()
    expect(readWhatsappSignupEvent(message(JSON.stringify([1, 2])))).toBeNull()
    expect(readWhatsappSignupEvent(message({ type: "WA_OTHER" }))).toBeNull()
    expect(
      readWhatsappSignupEvent(message({ type: "WA_EMBEDDED_SIGNUP" }))
    ).toBeNull()
    expect(
      readWhatsappSignupEvent(message({ type: "WA_EMBEDDED_SIGNUP", event: 3 }))
    ).toBeNull()
  })

  it("accepts an already deserialized payload", () => {
    expect(
      readWhatsappSignupEvent({
        isTrusted: true,
        origin: "https://www.facebook.com",
        data: FINISH_PAYLOAD,
      })
    ).toMatchObject({ kind: "finished" })
  })

  it("accepts numeric ids without losing them to the type check", () => {
    expect(
      readWhatsappSignupEvent(
        message({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { waba_id: 524126980791429, phone_number_id: 106540352242922 },
        })
      )
    ).toEqual({
      kind: "finished",
      assets: {
        wabaId: "524126980791429",
        phoneNumberId: "106540352242922",
        businessId: null,
      },
    })
  })
})

describe("readWhatsappSignupEvent — clasificación del desenlace", () => {
  it("treats a FINISH without a phone number as a finish without number", () => {
    expect(
      readWhatsappSignupEvent(
        message({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { waba_id: "524126980791429" },
        })
      )
    ).toEqual({ kind: "finished-without-number" })
  })

  it("reports a FINISH without a WABA as malformed", () => {
    expect(
      readWhatsappSignupEvent(
        message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: {} })
      )
    ).toEqual({ kind: "malformed" })
  })

  it("maps FINISH_ONLY_WABA to the same outcome as a FINISH with no number", () => {
    expect(
      readWhatsappSignupEvent(
        message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_ONLY_WABA" })
      )
    ).toEqual({ kind: "finished-without-number" })
  })

  it("marks the other FINISH_* flows as unsupported, including unknown ones", () => {
    for (const event of [
      "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      "FINISH_OBO_MIGRATION",
      "FINISH_GRANT_ONLY_API_ACCESS",
      "FINISH_SOMETHING_META_ADDS_LATER",
    ]) {
      expect(
        readWhatsappSignupEvent(
          message({ type: "WA_EMBEDDED_SIGNUP", event, data: { waba_id: "1" } })
        )
      ).toEqual({ kind: "unsupported-flow", event })
    }
  })

  it("reads the ERROR event", () => {
    expect(
      readWhatsappSignupEvent(
        message({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR" })
      )
    ).toEqual({ kind: "flow-error" })
  })

  // La trampa de esta API: el error reportado por el usuario también llega con
  // `event: 'CANCEL'` y solo se distingue por las claves de `data`.
  it("splits CANCEL into a reported error and an abandonment", () => {
    expect(
      readWhatsappSignupEvent(
        message({
          type: "WA_EMBEDDED_SIGNUP",
          event: "CANCEL",
          data: {
            error_message:
              "Your verified name violates WhatsApp guidelines. Please edit your verified name and try again.",
            error_code: 524126,
            session_id: "f34b51dab5e0498",
            timestamp: "1746041036",
          },
        })
      )
    ).toEqual({
      kind: "reported-error",
      errorMessage:
        "Your verified name violates WhatsApp guidelines. Please edit your verified name and try again.",
      errorCode: "524126",
      sessionId: "f34b51dab5e0498",
    })

    expect(
      readWhatsappSignupEvent(
        message({
          type: "WA_EMBEDDED_SIGNUP",
          event: "CANCEL",
          data: { current_step: "PHONE_NUMBER_SETUP" },
        })
      )
    ).toEqual({ kind: "abandoned", currentStep: "PHONE_NUMBER_SETUP" })
  })

  it("survives a CANCEL with no data at all", () => {
    expect(
      readWhatsappSignupEvent(
        message({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL" })
      )
    ).toEqual({ kind: "abandoned", currentStep: null })
  })

  it("truncates a reported error long enough to break the notice", () => {
    const event = readWhatsappSignupEvent(
      message({
        type: "WA_EMBEDDED_SIGNUP",
        event: "CANCEL",
        data: { error_message: "x".repeat(500) },
      })
    )

    expect(event?.kind).toBe("reported-error")
    if (event?.kind !== "reported-error") return
    expect(event.errorMessage).toHaveLength(241)
    expect(event.errorMessage.endsWith("…")).toBe(true)
  })
})

describe("describeWhatsappSignupEvent", () => {
  it("says nothing for the happy path or for a rejected origin", () => {
    expect(
      describeWhatsappSignupEvent({
        kind: "finished",
        assets: { wabaId: "1", phoneNumberId: "2", businessId: null },
      })
    ).toBeNull()
    expect(
      describeWhatsappSignupEvent({
        kind: "foreign-origin",
        origin: "https://evil.example",
      })
    ).toBeNull()
  })

  // Lo que NO puede pasar: que un flujo que terminó bien se cuente como error
  // genérico y mande a la persona a reintentar en bucle.
  it("names the unsupported flow instead of failing generically", () => {
    const coexistence = describeWhatsappSignupEvent({
      kind: "unsupported-flow",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    })
    expect(coexistence).toContain("app de WhatsApp Business")
    expect(coexistence).toContain("todavía no está soportado")

    expect(
      describeWhatsappSignupEvent({
        kind: "unsupported-flow",
        event: "FINISH_OBO_MIGRATION",
      })
    ).toContain("migración")

    expect(
      describeWhatsappSignupEvent({
        kind: "unsupported-flow",
        event: "FINISH_GRANT_ONLY_API_ACCESS",
      })
    ).toContain("sin conectar un número")

    // Un `FINISH*` que Meta agregue después: sigue diciendo que no está
    // soportado y cita el valor, en vez de callarse.
    expect(
      describeWhatsappSignupEvent({
        kind: "unsupported-flow",
        event: "FINISH_NEW_THING",
      })
    ).toContain("FINISH_NEW_THING")
  })

  it("tells the user which screen they closed", () => {
    expect(
      describeWhatsappSignupEvent({
        kind: "abandoned",
        currentStep: "PHONE_NUMBER_VERIFICATION",
      })
    ).toContain("la verificación del número")

    // Un `current_step` que no conocemos no se pinta crudo.
    const unknown = describeWhatsappSignupEvent({
      kind: "abandoned",
      currentStep: "SOMETHING_NEW",
    })
    expect(unknown).not.toContain("SOMETHING_NEW")
    expect(unknown).toContain("Cerraste la ventana de Meta")
  })

  it("passes Meta's own error text through with its support references", () => {
    expect(
      describeWhatsappSignupEvent({
        kind: "reported-error",
        errorMessage: "Phone Number has been blocked.",
        errorCode: "524126",
        sessionId: "f34b51dab5e0498",
      })
    ).toBe(
      "Meta rechazó la conexión: Phone Number has been blocked. (código 524126 · sesión f34b51dab5e0498 — cítalos si escribes a soporte)."
    )

    expect(
      describeWhatsappSignupEvent({
        kind: "reported-error",
        errorMessage: "Phone Number has been blocked.",
        errorCode: null,
        sessionId: null,
      })
    ).toBe("Meta rechazó la conexión: Phone Number has been blocked.")
  })

  it("has a message for every remaining outcome", () => {
    expect(
      describeWhatsappSignupEvent({ kind: "finished-without-number" })
    ).toContain("sin agregar un número")
    expect(describeWhatsappSignupEvent({ kind: "flow-error" })).toContain(
      "Vuelve a intentarlo"
    )
    expect(describeWhatsappSignupEvent({ kind: "malformed" })).toContain(
      "respuesta incompleta"
    )
  })
})
