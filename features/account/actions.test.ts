import { beforeEach, describe, expect, it, vi } from "vitest"
import { APIError } from "better-auth/api"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  setUserPassword: vi.fn(),
  revokeOtherSessions: vi.fn(),
  linkSocialAccount: vi.fn(),
  unlinkAccount: vi.fn(),
  isGoogleEnabled: vi.fn(),
  isEmailVerified: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  log: vi.fn(),
}))

// El idioma de la acción sale de la cookie `lang`. Sin store —lo que devuelve
// este mock por defecto— cae en español, que es el idioma de las aserciones.
// `headers()` lo necesita `revokeOtherSessions` para identificar la sesión
// actual.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
  headers: async () => new Headers(),
}))

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
  signOut: mocks.signOut,
}))

vi.mock("@/lib/auth/set-password", () => ({
  setUserPassword: mocks.setUserPassword,
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

vi.mock("next/navigation", () => ({
  // `redirect()` funciona lanzando: el mock imita eso para que los tests
  // puedan distinguir "redirigió" de "devolvió un error".
  redirect: (url: string) => {
    mocks.redirect(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

vi.mock("@/lib/auth/auth", () => ({
  getAuth: () => ({
    api: {
      revokeOtherSessions: mocks.revokeOtherSessions,
      linkSocialAccount: mocks.linkSocialAccount,
      unlinkAccount: mocks.unlinkAccount,
    },
  }),
}))

vi.mock("@/lib/auth/google", () => ({
  isGoogleEnabled: mocks.isGoogleEnabled,
}))

vi.mock("@/lib/auth/email-verified", () => ({
  isEmailVerified: mocks.isEmailVerified,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import { es } from "@/content/i18n/app/es"

import {
  changePasswordAction,
  linkGoogleAction,
  unlinkGoogleAction,
} from "./actions"

function passwordForm(password = "contraseñaNueva") {
  const formData = new FormData()
  formData.set("newPassword", password)
  formData.set("confirmPassword", password)
  return formData
}

describe("changePasswordAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.setUserPassword.mockResolvedValue(undefined)
    mocks.revokeOtherSessions.mockResolvedValue(undefined)
    mocks.signOut.mockResolvedValue(undefined)
  })

  it("writes the password before revoking the other sessions", async () => {
    const order: string[] = []
    mocks.setUserPassword.mockImplementation(async () => {
      order.push("setPassword")
    })
    mocks.revokeOtherSessions.mockImplementation(async () => {
      order.push("revoke")
    })
    mocks.signOut.mockImplementation(async () => {
      order.push("signOut")
    })

    await expect(changePasswordAction({}, passwordForm())).resolves.toEqual({})
    expect(order).toEqual(["setPassword", "revoke", "signOut"])
  })

  // La fila de `users` ya no existe pero el caché JWE todavía resuelve la
  // sesión: antes esto era un 500.
  it("returns accountNotFound when the password cannot be written", async () => {
    mocks.setUserPassword.mockRejectedValue(
      new Error(
        'insert or update on table "auth_accounts" violates foreign key'
      )
    )

    await expect(changePasswordAction({}, passwordForm())).resolves.toEqual({
      error: es.actions.accountNotFound,
    })

    // Nada más pasó: ni se revocó, ni se cerró la sesión actual.
    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "password_change",
        outcome: "failed",
        reason: "internal_error",
        tenantId: "tenant-1",
      })
    )
  })

  // La contraseña ya cambió: fallar acá no puede devolver un 500 ni dejar a la
  // persona sin saber en qué estado quedó.
  it("still signs out and logs when revoking the other sessions fails", async () => {
    mocks.revokeOtherSessions.mockRejectedValue(new Error("revoke exploded"))

    await expect(changePasswordAction({}, passwordForm())).resolves.toEqual({})

    expect(mocks.setUserPassword).toHaveBeenCalledWith(
      "tenant-1",
      "contraseñaNueva"
    )
    expect(mocks.signOut).toHaveBeenCalledWith({
      redirectTo: "/login?passwordChanged=1",
    })
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session_revoke",
        outcome: "failed",
        reason: "internal_error",
        tenantId: "tenant-1",
      })
    )
  })
})

describe("linkGoogleAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.isGoogleEnabled.mockReturnValue(true)
    mocks.isEmailVerified.mockResolvedValue(true)
    mocks.linkSocialAccount.mockResolvedValue({
      url: "https://accounts.google.com/o/oauth2/auth?state=abc",
      redirect: false,
    })
  })

  it("redirige a la URL de autorización y vuelve a la pestaña Cuenta", async () => {
    await expect(linkGoogleAction()).rejects.toThrow(
      "NEXT_REDIRECT:https://accounts.google.com"
    )

    expect(mocks.linkSocialAccount).toHaveBeenCalledWith({
      body: {
        provider: "google",
        callbackURL: "/settings?tab=cuenta",
        errorCallbackURL: "/settings?tab=cuenta",
        disableRedirect: true,
      },
      headers: expect.any(Headers),
    })
  })

  // La librería lo rechazaría igual, pero después del viaje a Google. Cortar
  // acá, con la bandera leída viva, ahorra el viaje y da el mismo mensaje.
  it("sin correo confirmado no llama a la librería y explica por qué", async () => {
    mocks.isEmailVerified.mockResolvedValue(false)

    await expect(linkGoogleAction()).resolves.toEqual({
      error: es.actions.oauthAccountNotLinked,
    })
    expect(mocks.linkSocialAccount).not.toHaveBeenCalled()
  })

  it("con Google apagado contesta sin llamar", async () => {
    mocks.isGoogleEnabled.mockReturnValue(false)

    await expect(linkGoogleAction()).resolves.toEqual({
      error: es.actions.googleNotConfigured,
    })
    expect(mocks.linkSocialAccount).not.toHaveBeenCalled()
  })

  it("sin sesión no hace nada", async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(linkGoogleAction()).resolves.toEqual({
      error: es.actions.notSignedIn,
    })
    expect(mocks.isEmailVerified).not.toHaveBeenCalled()
  })
})

describe("unlinkGoogleAction", () => {
  function unlinkForm(accountId = "acc-google") {
    const formData = new FormData()
    formData.set("accountId", accountId)
    return formData
  }

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.unlinkAccount.mockResolvedValue({ status: true })
  })

  it("desvincula y revalida Settings para que la fila cambie sola", async () => {
    await expect(unlinkGoogleAction({}, unlinkForm())).resolves.toEqual({})

    expect(mocks.unlinkAccount).toHaveBeenCalledWith({
      body: { accountId: "acc-google" },
      headers: expect.any(Headers),
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })

  // **La regla que el ticket pide blindar**: la librería se niega a quitar la
  // última credencial y el mensaje lo dice con las palabras del diccionario.
  it("quitar la última credencial se rechaza con su mensaje", async () => {
    mocks.unlinkAccount.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "FAILED_TO_UNLINK_LAST_ACCOUNT" })
    )

    await expect(unlinkGoogleAction({}, unlinkForm())).resolves.toEqual({
      error: es.actions.unlinkLastCredential,
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("una sesión no fresca da su mensaje", async () => {
    mocks.unlinkAccount.mockRejectedValue(
      new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH" })
    )

    await expect(unlinkGoogleAction({}, unlinkForm())).resolves.toEqual({
      error: es.actions.sessionNotFresh,
    })
  })

  it("una cuenta que no está da accountNotFound; un código raro, el genérico", async () => {
    mocks.unlinkAccount.mockRejectedValueOnce(
      new APIError("BAD_REQUEST", { code: "ACCOUNT_NOT_FOUND" })
    )
    await expect(unlinkGoogleAction({}, unlinkForm())).resolves.toEqual({
      error: es.actions.accountNotFound,
    })

    mocks.unlinkAccount.mockRejectedValueOnce(
      new APIError("BAD_REQUEST", { code: "SOMETHING_ELSE" })
    )
    await expect(unlinkGoogleAction({}, unlinkForm())).resolves.toEqual({
      error: es.actions.linkFailed,
    })
  })

  it("sin accountId no llama a la librería", async () => {
    await expect(unlinkGoogleAction({}, unlinkForm(""))).resolves.toEqual({
      error: es.actions.accountNotFound,
    })
    expect(mocks.unlinkAccount).not.toHaveBeenCalled()
  })
})
