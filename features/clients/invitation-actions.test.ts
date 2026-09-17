import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  redirect: vi.fn(),
  allowAuthAttempt: vi.fn(),
  acceptInvitation: vi.fn(),
  signInEmail: vi.fn(),
}))

// El idioma sale de la cookie `lang`; sin store cae en español, que es el
// idioma de las aserciones de abajo (patrón de `features/clients/actions`).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
  headers: async () => new Headers(),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))
vi.mock("@/lib/auth/rate-limit", () => ({
  allowAuthAttempt: mocks.allowAuthAttempt,
}))
vi.mock("@/lib/auth/auth", () => ({
  getAuth: () => ({ api: { signInEmail: mocks.signInEmail } }),
}))
vi.mock("@/lib/clients/invitations", () => ({
  acceptInvitation: mocks.acceptInvitation,
}))
vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { APIError } from "better-auth/api"

import { es } from "@/content/i18n/app/es"

import { acceptInvitationAction } from "./invitation-actions"

function form(input: Partial<Record<string, string>> = {}) {
  const formData = new FormData()
  formData.set("token", input.token ?? "tok-123")
  formData.set("name", input.name ?? "  Sol Pérez ")
  formData.set("password", input.password ?? "correct horse")
  formData.set("confirmPassword", input.confirmPassword ?? "correct horse")
  return formData
}

const accepted = {
  ok: true as const,
  userId: "user-9",
  email: "cliente@example.com",
  tenantId: "parent-1",
  clientAccountId: "client-1",
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.cookieGet.mockReturnValue(undefined)
  mocks.allowAuthAttempt.mockResolvedValue(true)
  mocks.acceptInvitation.mockResolvedValue(accepted)
  mocks.signInEmail.mockResolvedValue({ token: "session", user: {} })
})

describe("acceptInvitationAction", () => {
  it("acepta, inicia sesión con la credencial nueva y manda a Conexiones", async () => {
    await expect(acceptInvitationAction({}, form())).rejects.toThrow(
      "NEXT_REDIRECT:/connections"
    )

    expect(mocks.acceptInvitation).toHaveBeenCalledWith({
      token: "tok-123",
      name: "Sol Pérez",
      password: "correct horse",
    })
    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "cliente@example.com",
          password: "correct horse",
          rememberMe: true,
        },
      })
    )
    expect(mocks.redirect).toHaveBeenCalledWith("/connections")
  })

  it("valida nombre, contraseña y confirmación antes de tocar la base", async () => {
    expect(await acceptInvitationAction({}, form({ name: "  " }))).toEqual({
      error: es.actions.invitationNameRequired,
    })
    expect(
      await acceptInvitationAction(
        {},
        form({ password: "short", confirmPassword: "short" })
      )
    ).toEqual({ error: es.actions.passwordTooShort })
    expect(
      await acceptInvitationAction({}, form({ confirmPassword: "otra cosa" }))
    ).toEqual({ error: es.actions.passwordsDoNotMatch })
    expect(mocks.acceptInvitation).not.toHaveBeenCalled()
  })

  it("una invitación vencida o cancelada no abre sesión", async () => {
    mocks.acceptInvitation.mockResolvedValue({
      ok: false,
      reason: "expired",
    })
    expect(await acceptInvitationAction({}, form())).toEqual({
      error: es.actions.invitationExpired,
    })

    mocks.acceptInvitation.mockResolvedValue({
      ok: false,
      reason: "cancelled",
    })
    expect(await acceptInvitationAction({}, form())).toEqual({
      error: es.actions.invitationCancelled,
    })
    expect(mocks.signInEmail).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("el límite por IP corta antes de validar", async () => {
    mocks.allowAuthAttempt.mockResolvedValue(false)
    expect(await acceptInvitationAction({}, form({ name: "" }))).toEqual({
      error: es.actions.tooManyAttempts,
    })
    expect(mocks.acceptInvitation).not.toHaveBeenCalled()
  })

  it("si la sesión no abre, el acceso ya existe y se dice cómo entrar", async () => {
    mocks.signInEmail.mockRejectedValue(
      new APIError("UNAUTHORIZED", { message: "nope" })
    )
    expect(await acceptInvitationAction({}, form())).toEqual({
      error: es.actions.invitationSignInFailed,
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
