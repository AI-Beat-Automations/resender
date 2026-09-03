import { afterEach, describe, expect, it, vi } from "vitest"

import { en } from "@/content/i18n/en"
import { es } from "@/content/i18n/es"

import {
  accountLinkedSubject,
  accountLinkedVariables,
  sendAccountLinkedEmail,
} from "./account-linked-email"

// Las ocho variables que declara la plantilla de Resend
// (`docs/email/account-linked.html`). Si alguien suma una novena acá sin
// declararla en Resend, el correo sale con un hueco; si borra una, la API
// rechaza el envío entero.
const TEMPLATE_VARIABLES = [
  "PREHEADER",
  "HEADING",
  "INTRO",
  "BODY",
  "WARNING_LABEL",
  "CTA_LABEL",
  "FORGOT_URL",
  "FOOTER_NOTE",
]

const INPUT = {
  googleEmail: "ada@example.com",
  forgotPasswordUrl: "https://resender.dev/forgot-password",
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RESEND_TEMPLATE_ACCOUNT_LINKED
})

describe("accountLinkedVariables", () => {
  it("devuelve las ocho variables y ninguna vacía", () => {
    for (const locale of ["es", "en"] as const) {
      const vars = accountLinkedVariables(locale, INPUT)
      expect(Object.keys(vars).sort()).toEqual([...TEMPLATE_VARIABLES].sort())
      for (const [key, value] of Object.entries(vars)) {
        expect(value, `${locale}.${key}`).not.toBe("")
      }
    }
  })

  it("pasa el href recibido tal cual en FORGOT_URL", () => {
    const href = "https://resender.dev/en/forgot-password"
    expect(
      accountLinkedVariables("en", { ...INPUT, forgotPasswordUrl: href })
        .FORGOT_URL
    ).toBe(href)
  })

  it("interpola la dirección de Google en la intro y no deja el marcador", () => {
    for (const locale of ["es", "en"] as const) {
      const intro = accountLinkedVariables(locale, INPUT).INTRO
      expect(intro).toContain("ada@example.com")
      expect(intro).not.toContain("{googleEmail}")
    }
  })

  it("saca el copy del diccionario, no de la plantilla", () => {
    expect(accountLinkedVariables("es", INPUT).HEADING).toBe(
      es.auth.accountLinkedEmail.heading
    )
    expect(accountLinkedVariables("en", INPUT).HEADING).toBe(
      en.auth.accountLinkedEmail.heading
    )
  })

  it("dice que la contraseña sigue funcionando y no manda a soporte", () => {
    // Las dos promesas del #98: ninguna credencial se borra, y el «si no
    // fuiste tú» es autoservicio (cambiar la contraseña), no un buzón.
    for (const locale of ["es", "en"] as const) {
      const vars = accountLinkedVariables(locale, INPUT)
      expect(vars.WARNING_LABEL).not.toContain("info@")
      expect(vars.BODY).not.toContain("info@")
    }
    expect(accountLinkedVariables("es", INPUT).BODY).toMatch(
      /sigue funcionando/
    )
    expect(accountLinkedVariables("en", INPUT).BODY).toMatch(/still works/)
  })
})

describe("accountLinkedSubject", () => {
  it("da asuntos distintos por idioma, los dos del diccionario", () => {
    expect(accountLinkedSubject("es")).toBe(es.auth.accountLinkedEmail.subject)
    expect(accountLinkedSubject("en")).toBe(en.auth.accountLinkedEmail.subject)
    expect(accountLinkedSubject("es")).not.toBe(accountLinkedSubject("en"))
  })
})

describe("sendAccountLinkedEmail", () => {
  it("sin el id de plantilla devuelve not_configured sin llamar a Resend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const result = await sendAccountLinkedEmail({
      to: "ada@example.com",
      locale: "es",
      ...INPUT,
    })
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
