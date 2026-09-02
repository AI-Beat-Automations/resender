import { afterEach, describe, expect, it, vi } from "vitest"

import { en } from "@/content/i18n/en"
import { es } from "@/content/i18n/es"

import {
  sendVerifyEmail,
  verifyEmailSubject,
  verifyEmailVariables,
} from "./verify-email-email"

// Las nueve variables que declara la plantilla de Resend
// (`docs/email/verify-email.html`). Si alguien suma una décima acá sin
// declararla en Resend, el correo sale con un hueco; si borra una, la API
// rechaza el envío entero.
const TEMPLATE_VARIABLES = [
  "PREHEADER",
  "GREETING",
  "INTRO",
  "CTA_LABEL",
  "VERIFY_URL",
  "EXPIRY_NOTE",
  "FALLBACK_LABEL",
  "IGNORE_NOTE",
  "FOOTER_NOTE",
]

const INPUT = { name: "Ada", verifyUrl: "https://resender.dev/x" }

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RESEND_TEMPLATE_VERIFY_EMAIL
})

describe("verifyEmailVariables", () => {
  it("devuelve las nueve variables y ninguna vacía", () => {
    for (const locale of ["es", "en"] as const) {
      const vars = verifyEmailVariables(locale, INPUT)
      expect(Object.keys(vars).sort()).toEqual([...TEMPLATE_VARIABLES].sort())
      for (const [key, value] of Object.entries(vars)) {
        expect(value, `${locale}.${key}`).not.toBe("")
      }
    }
  })

  it("pasa el href recibido tal cual en VERIFY_URL", () => {
    const href =
      "https://resender.dev/api/auth/verify-email?token=abc&callbackURL=%2Fpending"
    expect(
      verifyEmailVariables("en", { ...INPUT, verifyUrl: href }).VERIFY_URL
    ).toBe(href)
  })

  it("interpola el nombre en el saludo y no deja el marcador", () => {
    for (const locale of ["es", "en"] as const) {
      const greeting = verifyEmailVariables(locale, INPUT).GREETING
      expect(greeting).toContain("Ada")
      expect(greeting).not.toContain("{name}")
    }
  })

  it("saca el copy del diccionario, no de la plantilla", () => {
    expect(verifyEmailVariables("es", INPUT).INTRO).toBe(
      es.auth.verifyEmail.intro
    )
    expect(verifyEmailVariables("en", INPUT).INTRO).toBe(
      en.auth.verifyEmail.intro
    )
  })

  it("conserva la línea que protege contra el registro ajeno", () => {
    // «Si no creaste esta cuenta, ignora este mensaje» no es relleno: es lo
    // que evita confirmar una cuenta que registró otro con tu dirección.
    expect(verifyEmailVariables("es", INPUT).IGNORE_NOTE).toBe(
      es.auth.verifyEmail.ignoreNote
    )
  })
})

describe("verifyEmailSubject", () => {
  it("da asuntos distintos por idioma, los dos del diccionario", () => {
    expect(verifyEmailSubject("es")).toBe(es.auth.verifyEmail.subject)
    expect(verifyEmailSubject("en")).toBe(en.auth.verifyEmail.subject)
    expect(verifyEmailSubject("es")).not.toBe(verifyEmailSubject("en"))
  })
})

describe("sendVerifyEmail", () => {
  it("sin el id de plantilla devuelve not_configured sin llamar a Resend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const result = await sendVerifyEmail({
      to: "ada@example.com",
      locale: "es",
      name: "Ada",
      verifyUrl: "https://resender.dev/api/auth/verify-email?token=x",
    })
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
