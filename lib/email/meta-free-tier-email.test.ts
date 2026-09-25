import { afterEach, describe, expect, it, vi } from "vitest"

import { en } from "@/content/i18n/app/en"
import { es } from "@/content/i18n/app/es"

import {
  metaFreeTierSubject,
  metaFreeTierVariables,
  sendMetaFreeTierEmail,
} from "./meta-free-tier-email"

// Las diez variables que declara la plantilla `meta-free-tier`
// (`docs/email/meta-free-tier.html`). Si alguien suma una acá sin declararla
// en Resend, el correo sale con un hueco; si borra una, la API rechaza el
// envío entero.
const TEMPLATE_VARIABLES = [
  "PREHEADER",
  "HEADING",
  "INTRO",
  "BODY",
  "NOTE",
  "CTA_LABEL",
  "CONNECTIONS_URL",
  "PRICING_LABEL",
  "PRICING_URL",
  "FOOTER_NOTE",
]

const input = {
  threshold: 80 as const,
  phone: "+5215550000000",
  used: 1234,
  limit: 1000,
  connectionsUrl: "https://resender.dev/connections",
  pricingUrl: "https://developers.facebook.com/pricing",
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RESEND_TEMPLATE_META_FREE_TIER
})

describe("metaFreeTierVariables", () => {
  it("devuelve las diez variables y ninguna vacía, en los dos umbrales", () => {
    for (const locale of ["es", "en"] as const) {
      for (const threshold of [80, 100] as const) {
        const vars = metaFreeTierVariables(locale, { ...input, threshold })
        expect(Object.keys(vars).sort()).toEqual([...TEMPLATE_VARIABLES].sort())
        for (const [key, value] of Object.entries(vars)) {
          expect(value, `${locale}.${threshold}.${key}`).not.toBe("")
        }
      }
    }
  })

  it("interpola el número y formatea las cifras con el idioma", () => {
    const vars = metaFreeTierVariables("en", input)
    expect(vars.INTRO).toContain("+5215550000000")
    expect(vars.INTRO).toContain("1,234")
    expect(vars.INTRO).toContain("1,000")
    expect(vars.INTRO).not.toContain("{")
    expect(vars.CONNECTIONS_URL).toBe(input.connectionsUrl)
    expect(vars.PRICING_URL).toBe(input.pricingUrl)
  })

  it("cambia las palabras según el umbral", () => {
    expect(metaFreeTierVariables("es", input).HEADING).toBe(
      es.metaFreeTier.email.heading80
    )
    expect(
      metaFreeTierVariables("en", { ...input, threshold: 100 }).HEADING
    ).toBe(en.metaFreeTier.email.heading100)
  })

  // Lo que no puede faltar en ningún correo: que es cobro de Meta y no nuestro.
  it("aclara que no es la cuota del plan de Resender", () => {
    expect(metaFreeTierVariables("es", input).NOTE).toBe(
      es.metaFreeTier.email.notResenderNote
    )
  })
})

describe("metaFreeTierSubject", () => {
  it("lleva el número y cambia con el umbral y el idioma", () => {
    expect(metaFreeTierSubject("es", 80, "+52155")).toBe(
      "+52155 ya usó el 80 % de sus mensajes gratis de Meta"
    )
    expect(metaFreeTierSubject("en", 100, "+52155")).toBe(
      "+52155 has used up its free Meta messages for this month"
    )
  })
})

describe("sendMetaFreeTierEmail", () => {
  it("sin el id de plantilla devuelve not_configured sin llamar a Resend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const result = await sendMetaFreeTierEmail({
      ...input,
      to: "duena@example.com",
      locale: "es",
    })
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("con plantilla y credenciales manda las variables del umbral", async () => {
    process.env.RESEND_TEMPLATE_META_FREE_TIER = "tpl-meta"
    process.env.RESEND_API_KEY = "re_test"
    process.env.EMAIL_FROM = "Resender <no-reply@resender.dev>"
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }))

    const result = await sendMetaFreeTierEmail({
      ...input,
      threshold: 100,
      to: "duena@example.com",
      locale: "es",
    })

    expect(result.ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body.to).toEqual(["duena@example.com"])
    expect(body.subject).toBe(
      "+5215550000000 agotó sus mensajes gratis de Meta de este mes"
    )
    expect(body.template).toEqual({
      id: "tpl-meta",
      variables: metaFreeTierVariables("es", { ...input, threshold: 100 }),
    })

    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
  })
})
