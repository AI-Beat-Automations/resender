import { afterEach, describe, expect, it, vi } from "vitest"

import { en } from "@/content/i18n/app/en"
import { es } from "@/content/i18n/app/es"

import {
  clientInvitationSubject,
  clientInvitationVariables,
  sendClientInvitationEmail,
} from "./client-invitation-email"

// Las nueve variables que declara la plantilla `client-invitation`. Si alguien
// suma una décima acá sin declararla en Resend, el correo sale con un hueco;
// si borra una, la API rechaza el envío entero.
const TEMPLATE_VARIABLES = [
  "PREHEADER",
  "GREETING",
  "INTRO",
  "CTA_LABEL",
  "INVITE_URL",
  "EXPIRY_NOTE",
  "FALLBACK_LABEL",
  "IGNORE_NOTE",
  "FOOTER_NOTE",
]

const input = {
  clientName: "Panadería Sol",
  ownerName: "Ada Lovelace",
  inviteUrl: "https://resender.dev/invitacion/abc123",
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RESEND_TEMPLATE_CLIENT_INVITATION
})

describe("clientInvitationVariables", () => {
  it("devuelve las nueve variables y ninguna vacía", () => {
    for (const locale of ["es", "en"] as const) {
      const vars = clientInvitationVariables(locale, input)
      expect(Object.keys(vars).sort()).toEqual([...TEMPLATE_VARIABLES].sort())
      for (const [key, value] of Object.entries(vars)) {
        expect(value, `${locale}.${key}`).not.toBe("")
      }
    }
  })

  it("pasa el href tal cual y mete los nombres ya resueltos", () => {
    const vars = clientInvitationVariables("es", input)
    expect(vars.INVITE_URL).toBe(input.inviteUrl)
    expect(vars.GREETING).toContain("Panadería Sol")
    expect(vars.INTRO).toContain("Ada Lovelace")
    expect(vars.INTRO).not.toContain("{owner}")
  })

  it("saca el copy del diccionario del producto, no de la plantilla", () => {
    expect(clientInvitationVariables("es", input).CTA_LABEL).toBe(
      es.clients.invitationEmail.ctaLabel
    )
    expect(clientInvitationVariables("en", input).CTA_LABEL).toBe(
      en.clients.invitationEmail.ctaLabel
    )
  })
})

describe("clientInvitationSubject", () => {
  it("lleva el nombre del padre y cambia con el idioma", () => {
    expect(clientInvitationSubject("es", "Ada")).toBe(
      "Ada te invita a Resender"
    )
    expect(clientInvitationSubject("en", "Ada")).toBe(
      "Ada invited you to Resender"
    )
  })
})

describe("sendClientInvitationEmail", () => {
  it("sin el id de plantilla devuelve not_configured sin llamar a Resend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const result = await sendClientInvitationEmail({
      ...input,
      to: "cliente@example.com",
      locale: "es",
    })
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("con plantilla y credenciales manda asunto con el nombre del padre", async () => {
    process.env.RESEND_TEMPLATE_CLIENT_INVITATION = "tpl-1"
    process.env.RESEND_API_KEY = "re_test"
    process.env.EMAIL_FROM = "Resender <no-reply@resender.dev>"
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }))

    const result = await sendClientInvitationEmail({
      ...input,
      to: "cliente@example.com",
      locale: "en",
    })

    expect(result.ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body.to).toEqual(["cliente@example.com"])
    expect(body.subject).toBe("Ada Lovelace invited you to Resender")
    expect(body.template).toEqual({
      id: "tpl-1",
      variables: clientInvitationVariables("en", input),
    })

    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
  })
})
