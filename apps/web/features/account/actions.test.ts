import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  setUserPassword: vi.fn(),
  revokeOtherSessions: vi.fn(),
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

vi.mock("@/lib/auth/auth", () => ({
  getAuth: () => ({ api: { revokeOtherSessions: mocks.revokeOtherSessions } }),
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import { es } from "@/content/i18n/app/es"

import { changePasswordAction } from "./actions"

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
      new Error('insert or update on table "auth_accounts" violates foreign key')
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
