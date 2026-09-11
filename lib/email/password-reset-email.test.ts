import { afterEach, describe, expect, it, vi } from "vitest"

import { en } from "@/content/i18n/en"
import { es } from "@/content/i18n/es"

import {
  passwordResetSubject,
  passwordResetVariables,
  sendPasswordResetEmail,
} from "./password-reset-email"

// Las nueve variables que declara la plantilla `ee224341-…`. Si alguien suma
// una décima acá sin declararla en Resend, el correo sale con un hueco; si
// borra una, la API rechaza el envío entero.
const TEMPLATE_VARIABLES = [
  "PREHEADER",
  "HEADING",
  "INTRO",
  "CTA_LABEL",
  "RESET_URL",
  "EXPIRY_NOTE",
  "FALLBACK_LABEL",
  "IGNORE_NOTE",
  "FOOTER_NOTE",
]

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RESEND_TEMPLATE_PASSWORD_RESET
})

describe("passwordResetVariables", () => {
  it("devuelve las nueve variables y ninguna vacía", () => {
    for (const locale of ["es", "en"] as const) {
      const vars = passwordResetVariables(locale, "https://resender.dev/x")
      expect(Object.keys(vars).sort()).toEqual([...TEMPLATE_VARIABLES].sort())
      for (const [key, value] of Object.entries(vars)) {
        expect(value, `${locale}.${key}`).not.toBe("")
      }
    }
  })

  it("pasa el href recibido tal cual en RESET_URL", () => {
    const href = "https://resender.dev/en/reset-password?token=abc123"
    expect(passwordResetVariables("en", href).RESET_URL).toBe(href)
  })

  it("saca el copy del diccionario, no de la plantilla", () => {
    // El copy vive bajo control de versiones (ADR 0006): sacarlo a Resend lo
    // dejaría sin `git blame`, sin review y sin `dictionary.test.ts`.
    expect(passwordResetVariables("es", "https://x").HEADING).toBe(
      es.auth.resetEmail.heading
    )
    expect(passwordResetVariables("en", "https://x").HEADING).toBe(
      en.auth.resetEmail.heading
    )
  })
})

describe("passwordResetSubject", () => {
  it("da asuntos distintos por idioma, los dos del diccionario", () => {
    expect(passwordResetSubject("es")).toBe(es.auth.resetEmail.subject)
    expect(passwordResetSubject("en")).toBe(en.auth.resetEmail.subject)
    expect(passwordResetSubject("es")).not.toBe(passwordResetSubject("en"))
  })
})

describe("sendPasswordResetEmail", () => {
  it("sin el id de plantilla devuelve not_configured sin llamar a Resend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const result = await sendPasswordResetEmail({
      to: "ada@example.com",
      locale: "es",
      resetUrl: "https://resender.dev/reset-password?token=x",
    })
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
