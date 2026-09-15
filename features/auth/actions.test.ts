import { beforeEach, describe, expect, it, vi } from "vitest"
import { APIError } from "better-auth/api"

const mocks = vi.hoisted(() => ({
  allowAuthAttempt: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signUpEmail: vi.fn(),
  signInSocial: vi.fn(),
  sendVerificationEmail: vi.fn(),
  isGoogleEnabled: vi.fn(),
  getSession: vi.fn(),
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
      signUpEmail: mocks.signUpEmail,
      signInSocial: mocks.signInSocial,
      sendVerificationEmail: mocks.sendVerificationEmail,
    },
  }),
}))

vi.mock("@/lib/auth/google", () => ({
  isGoogleEnabled: mocks.isGoogleEnabled,
}))

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { es } from "@/content/i18n/es"

import {
  forgotPasswordAction,
  registerAction,
  resendVerificationEmailAction,
  resetPasswordAction,
  signInWithGoogleAction,
} from "./actions"

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
  mocks.signUpEmail.mockResolvedValue({
    token: "tok",
    user: { id: "u1", email: "ada@x.com" },
  })
  mocks.signInSocial.mockResolvedValue({
    url: "https://accounts.google.com/o/oauth2/auth?state=abc",
    redirect: false,
  })
  mocks.sendVerificationEmail.mockResolvedValue({ status: true })
  mocks.isGoogleEnabled.mockReturnValue(true)
  mocks.getSession.mockResolvedValue(null)
})

describe("registerAction", () => {
  // El [Enlace de verificacion] aterriza en `/pending`: es la única ruta que
  // ya decide bien por todos (rebota a quien tiene acceso, muestra la espera
  // a quien no). Sin este `callbackURL` la librería mandaría a `/`, donde
  // nadie lee el `?error=` de un enlace vencido.
  it("manda el enlace de verificación a /pending", async () => {
    await expect(
      registerAction(
        {},
        form({ name: "Ada", email: "ada@x.com", password: "contraseña1" })
      )
    ).rejects.toThrow("NEXT_REDIRECT:/connections")

    expect(mocks.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ callbackURL: "/pending" }),
      })
    )
  })
})

describe("signInWithGoogleAction", () => {
  it("redirige a la URL de autorización que devuelve la librería", async () => {
    await expect(
      signInWithGoogleAction({}, form({ locale: "es", from: "login" }))
    ).rejects.toThrow("NEXT_REDIRECT:https://accounts.google.com")

    expect(mocks.redirect).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/auth?state=abc"
    )
  })

  // `callbackURL: "/connections"` es deliberado: el destino lo decide el gate
  // de acceso, no la autenticación. `errorCallbackURL` es la pantalla de
  // origen con su idioma, porque ahí se dibuja el `?error=`.
  it.each([
    ["es", "login", "/login"],
    ["en", "login", "/en/login"],
    ["es", "register", "/register"],
    ["en", "register", "/en/register"],
  ])(
    "con locale=%s desde %s vuelve a %s si Google falla",
    async (locale, from, errorCallbackURL) => {
      await expect(
        signInWithGoogleAction({}, form({ locale, from }))
      ).rejects.toThrow("NEXT_REDIRECT")

      expect(mocks.signInSocial).toHaveBeenCalledWith({
        body: {
          provider: "google",
          callbackURL: "/connections",
          errorCallbackURL,
          disableRedirect: true,
        },
        headers: expect.any(Headers),
      })
    }
  )

  it("corta con el rate limit sin llamar a la librería", async () => {
    mocks.allowAuthAttempt.mockResolvedValue(false)

    const result = await signInWithGoogleAction({}, form({ from: "login" }))

    expect(result).toEqual({ error: es.auth.errors.tooManyAttempts })
    expect(mocks.signInSocial).not.toHaveBeenCalled()
  })

  it("con Google apagado contesta sin llamar a la librería", async () => {
    mocks.isGoogleEnabled.mockReturnValue(false)

    const result = await signInWithGoogleAction({}, form({ from: "login" }))

    expect(result).toEqual({ error: es.auth.errors.googleNotConfigured })
    expect(mocks.signInSocial).not.toHaveBeenCalled()
  })

  it("sin URL devuelve el error genérico en vez de redirigir a ningún lado", async () => {
    mocks.signInSocial.mockResolvedValue({ redirect: false })

    const result = await signInWithGoogleAction({}, form({ from: "login" }))

    expect(result).toEqual({ error: es.auth.errors.googleNotConfigured })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})

describe("resendVerificationEmailAction", () => {
  // **El caso que hay que blindar**, igual que en `forgotPasswordAction`: si
  // alguien "mejora" esto para avisar que el correo no existe o que el envío
  // falló, este test tiene que ponerse rojo.
  it("responde igual exista la cuenta, no exista, o lance la librería", async () => {
    const existe = await resendVerificationEmailAction(
      {},
      form({ email: "ada@x.com" })
    )

    // La librería responde lo mismo para el correo inexistente (con relleno
    // de tiempo), sin lanzar.
    const noExiste = await resendVerificationEmailAction(
      {},
      form({ email: "no@x.com" })
    )

    mocks.sendVerificationEmail.mockRejectedValueOnce(
      new APIError("BAD_REQUEST", { code: "EMAIL_ALREADY_VERIFIED" })
    )
    const yaVerificado = await resendVerificationEmailAction(
      {},
      form({ email: "ada@x.com" })
    )

    expect(existe).toEqual({ sent: true })
    expect(noExiste).toEqual(existe)
    expect(yaVerificado).toEqual(existe)
  })

  it("sin sesión y con correo inválido tampoco se distingue, y no llama", async () => {
    const result = await resendVerificationEmailAction(
      {},
      form({ email: "no-es-mail" })
    )

    expect(result).toEqual({ sent: true })
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it("manda el enlace a /pending, como el alta", async () => {
    await resendVerificationEmailAction({}, form({ email: "ada@x.com" }))

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      body: { email: "ada@x.com", callbackURL: "/pending" },
      headers: expect.any(Headers),
    })
  })

  // Que nadie use una pantalla autenticada (`/pending`, Settings) para
  // mandarle correos a otra dirección.
  it("con sesión usa el correo de la sesión e ignora el del formulario", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "u1", email: "sesion@x.com", name: "" },
    })

    await resendVerificationEmailAction({}, form({ email: "otro@x.com" }))

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: "sesion@x.com", callbackURL: "/pending" },
      })
    )
  })

  it("corta con el rate limit antes de tocar la base", async () => {
    mocks.allowAuthAttempt.mockResolvedValue(false)

    const result = await resendVerificationEmailAction(
      {},
      form({ email: "ada@x.com" })
    )

    expect(result).toEqual({ error: es.auth.errors.tooManyAttempts })
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
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
