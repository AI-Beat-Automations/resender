import { beforeEach, describe, expect, it, vi } from "vitest"
import { APIError } from "better-auth/api"

const mocks = vi.hoisted(() => ({
  allowAuthAttempt: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: async () => new Headers() }))

vi.mock("next/navigation", () => ({
  // `redirect()` funciona lanzando: el mock imita eso para que los tests
  // puedan distinguir "redirigió" de "devolvió un error".
  redirect: (url: string) => {
    mocks.redirect(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  allowAuthAttempt: mocks.allowAuthAttempt,
}))

vi.mock("@/lib/auth/auth", () => ({
  getAuth: () => ({
    api: {
      requestPasswordReset: mocks.requestPasswordReset,
      resetPassword: mocks.resetPassword,
    },
  }),
}))

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { es } from "@/content/i18n/es"

import { forgotPasswordAction, resetPasswordAction } from "./actions"

function form(entries: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) formData.set(key, value)
  return formData
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.allowAuthAttempt.mockResolvedValue(true)
  mocks.requestPasswordReset.mockResolvedValue({ status: true })
  mocks.resetPassword.mockResolvedValue({ status: true })
})

describe("forgotPasswordAction", () => {
  // **El caso que hay que blindar.** Si alguien "mejora" esto para avisar que
  // el email no existe o que el envío falló, este test tiene que ponerse rojo:
  // esa mejora convierte la pantalla en un oráculo de qué correos tienen
  // cuenta.
  it("devuelve el mismo estado exista la cuenta, no exista, o falle Resend", async () => {
    const existe = await forgotPasswordAction({}, form({ email: "ada@x.com" }))

    // La librería responde 200 para el email inexistente, sin llamar a
    // `sendResetPassword`.
    mocks.requestPasswordReset.mockResolvedValueOnce({ status: true })
    const noExiste = await forgotPasswordAction({}, form({ email: "no@x.com" }))

    // Resend caído: `sendResetPassword` no lanza, pero la librería sí puede.
    mocks.requestPasswordReset.mockRejectedValueOnce(
      new APIError("BAD_REQUEST", { message: "boom" })
    )
    const resendCaido = await forgotPasswordAction(
      {},
      form({ email: "ada@x.com" })
    )

    expect(existe).toEqual({ sent: true })
    expect(noExiste).toEqual(existe)
    expect(resendCaido).toEqual(existe)
  })

  it("un email inválido tampoco se distingue del resto", async () => {
    const result = await forgotPasswordAction({}, form({ email: "no-es-mail" }))
    expect(result).toEqual({ sent: true })
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
  })

  it("pasa la ruta localizada como redirectTo: por ahí viaja el idioma", async () => {
    await forgotPasswordAction({}, form({ email: "ada@x.com", locale: "en" }))
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      body: { email: "ada@x.com", redirectTo: "/en/reset-password" },
    })

    await forgotPasswordAction({}, form({ email: "ada@x.com", locale: "es" }))
    expect(mocks.requestPasswordReset).toHaveBeenLastCalledWith({
      body: { email: "ada@x.com", redirectTo: "/reset-password" },
    })
  })

  it("corta con el rate limit antes de tocar la base", async () => {
    // La única respuesta distinta, y es genérica por IP: no dice nada sobre
    // ninguna cuenta.
    mocks.allowAuthAttempt.mockResolvedValue(false)

    const result = await forgotPasswordAction({}, form({ email: "ada@x.com" }))

    expect(result).toEqual({ error: es.auth.errors.tooManyAttempts })
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
  })
})

describe("resetPasswordAction", () => {
  const valid = {
    token: "tok",
    password: "contraseñaNueva",
    confirmPassword: "contraseñaNueva",
  }

  it("valida el input con el diccionario ANTES de llamar a la librería", async () => {
    // `resetPassword` valida con su propio `minPasswordLength` y devuelve
    // `PASSWORD_TOO_SHORT` en inglés crudo, salteándose la ADR 0006.
    const corta = await resetPasswordAction(
      {},
      form({ ...valid, password: "corta", confirmPassword: "corta" })
    )
    expect(corta).toEqual({ error: es.auth.errors.passwordTooShort })

    const distintas = await resetPasswordAction(
      {},
      form({ ...valid, confirmPassword: "otraContraseña" })
    )
    expect(distintas).toEqual({ error: es.auth.errors.passwordsDoNotMatch })

    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })

  it("traduce el fallo de la librería al mensaje de enlace vencido", async () => {
    mocks.resetPassword.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "INVALID_TOKEN" })
    )
    expect(await resetPasswordAction({}, form(valid))).toEqual({
      error: es.auth.errors.resetLinkExpired,
    })
  })

  it("sin token no llama a la librería", async () => {
    const result = await resetPasswordAction({}, form({ ...valid, token: "" }))
    expect(result).toEqual({ error: es.auth.errors.resetLinkExpired })
    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })

  it("en éxito redirige al login del idioma con el aviso que ya existe", async () => {
    await expect(
      resetPasswordAction({}, form({ ...valid, locale: "en" }))
    ).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.resetPassword).toHaveBeenCalledWith({
      body: { newPassword: "contraseñaNueva", token: "tok" },
    })
    expect(mocks.redirect).toHaveBeenCalledWith("/en/login?passwordChanged=1")
  })
})
