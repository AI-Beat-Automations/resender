import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  allowWaitlistSignup: vi.fn(),
  createWaitlistSignup: vi.fn(),
}))

vi.mock("@/lib/waitlist/rate-limit", () => ({
  allowWaitlistSignup: mocks.allowWaitlistSignup,
}))

vi.mock("@/lib/waitlist/repository", () => ({
  createWaitlistSignup: mocks.createWaitlistSignup,
}))

vi.mock("@/lib/posthog", () => ({
  posthog: null,
}))

// `@/lib/waitlist/validation` y el diccionario NO se mockean: el primero es
// puro y es justo lo que hace que un `source` falsificado no llegue a la base,
// y el segundo es el que prueba que el error sale en el idioma de la página.
import { getDictionary } from "@/content/i18n"
import { CONSENT_VERSION } from "@/lib/waitlist/validation"

import { joinWaitlistAction } from "./actions"

const es = getDictionary("es").waitlist.errors
const en = getDictionary("en").waitlist.errors

const signupForm = (overrides: Record<string, string> = {}): FormData => {
  const fields: Record<string, string> = {
    locale: "es",
    source: "landing",
    email: "hola@empresa.com",
    heardFrom: "tiktok",
    consent: "on",
    ...overrides,
  }

  const formData = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value)
  }
  return formData
}

describe("joinWaitlistAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.allowWaitlistSignup.mockResolvedValue(true)
    mocks.createWaitlistSignup.mockResolvedValue({ created: true })
  })

  it("stores a new signup with the normalized email and the free-text detail", async () => {
    await expect(
      joinWaitlistAction(
        {},
        signupForm({
          email: "  Hola@Empresa.COM ",
          heardFrom: "other",
          heardFromOther: "  un podcast  ",
          source: "waitlist_page",
        })
      )
    ).resolves.toEqual({ success: true })

    expect(mocks.createWaitlistSignup).toHaveBeenCalledWith({
      email: "hola@empresa.com",
      source: "waitlist_page",
      heardFrom: "other",
      heardFromOther: "un podcast",
      consentVersion: CONSENT_VERSION,
    })
  })

  // El éxito idempotente de la ADR 0007: si la respuesta cambiara, cualquiera
  // podría averiguar si un correo ajeno está en la lista.
  it("answers a repeated email exactly like a new signup, without writing twice", async () => {
    mocks.createWaitlistSignup.mockResolvedValue({ created: false })

    await expect(joinWaitlistAction({}, signupForm())).resolves.toEqual({
      success: true,
    })

    expect(mocks.createWaitlistSignup).toHaveBeenCalledTimes(1)
  })

  // El `source` viaja en un campo oculto: el servidor lo decide, no el cliente.
  it("falls back to landing when the hidden source field is tampered with", async () => {
    await expect(
      joinWaitlistAction({}, signupForm({ source: "'; drop table --" }))
    ).resolves.toEqual({ success: true })

    expect(mocks.createWaitlistSignup).toHaveBeenCalledWith(
      expect.objectContaining({ source: "landing" })
    )
  })

  it("keeps waitlist_page when the hidden source field is one of the known values", async () => {
    await joinWaitlistAction({}, signupForm({ source: "waitlist_page" }))

    expect(mocks.createWaitlistSignup).toHaveBeenCalledWith(
      expect.objectContaining({ source: "waitlist_page" })
    )
  })

  it("fakes success and writes nothing when the honeypot is filled", async () => {
    await expect(
      joinWaitlistAction({}, signupForm({ nickname2: "Acme Inc" }))
    ).resolves.toEqual({ success: true })

    expect(mocks.createWaitlistSignup).not.toHaveBeenCalled()
    expect(mocks.allowWaitlistSignup).not.toHaveBeenCalled()
  })

  it("stops before the database when the rate limit is exceeded", async () => {
    mocks.allowWaitlistSignup.mockResolvedValue(false)

    await expect(joinWaitlistAction({}, signupForm())).resolves.toEqual({
      error: es.rateLimited,
    })

    expect(mocks.createWaitlistSignup).not.toHaveBeenCalled()
  })

  it("returns the dictionary message for every rejected field", async () => {
    await expect(
      joinWaitlistAction({}, signupForm({ email: "no-es-un-correo" }))
    ).resolves.toEqual({ error: es.email })

    const withoutConsent = signupForm()
    withoutConsent.delete("consent")
    await expect(joinWaitlistAction({}, withoutConsent)).resolves.toEqual({
      error: es.consent,
    })

    await expect(
      joinWaitlistAction({}, signupForm({ heardFrom: "telegram" }))
    ).resolves.toEqual({ error: es.heardFrom })

    await expect(
      joinWaitlistAction(
        {},
        signupForm({ heardFrom: "other", heardFromOther: "   " })
      )
    ).resolves.toEqual({ error: es.heardFromOther })

    await expect(
      joinWaitlistAction(
        {},
        signupForm({ heardFrom: "other", heardFromOther: "x".repeat(121) })
      )
    ).resolves.toEqual({ error: es.heardFromOtherTooLong })

    expect(mocks.createWaitlistSignup).not.toHaveBeenCalled()
  })

  // El formulario vive en `/` y en `/en`: el idioma sale del campo oculto
  // porque la action no ve el pathname que la invocó.
  it("answers in the language declared by the hidden locale field", async () => {
    await expect(
      joinWaitlistAction({}, signupForm({ locale: "en", email: "nope" }))
    ).resolves.toEqual({ error: en.email })

    mocks.allowWaitlistSignup.mockResolvedValue(false)
    await expect(
      joinWaitlistAction({}, signupForm({ locale: "en" }))
    ).resolves.toEqual({ error: en.rateLimited })

    expect(en.email).not.toBe(es.email)
  })

  it("shows the generic message instead of crashing when the database fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.createWaitlistSignup.mockRejectedValue(new Error("connection lost"))

    await expect(joinWaitlistAction({}, signupForm())).resolves.toEqual({
      error: es.unexpected,
    })

    consoleError.mockRestore()
  })
})
