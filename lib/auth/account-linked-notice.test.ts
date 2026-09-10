import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { sendMock, localeMock, logMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  localeMock: vi.fn(),
  logMock: vi.fn(),
}))

vi.mock("@/lib/email/account-linked-email", () => ({
  sendAccountLinkedEmail: sendMock,
}))
vi.mock("@/lib/auth/email-locale", () => ({
  resolveEmailLocale: localeMock,
}))
vi.mock("@/lib/observability/logger", () => ({
  log: logMock,
  describeError: (error: unknown) =>
    error instanceof Error ? error.message : "unknown error",
}))

import {
  notifyAccountLinked,
  shouldNotifyAccountLinked,
  type LinkedAccountHookContext,
} from "./account-linked-notice"

const USER = { id: "user-1", email: "ada@example.com", name: "Ada" }

function makeCtx(input: {
  credential: unknown
  user?: typeof USER | null
  request?: Request
}): LinkedAccountHookContext {
  return {
    request: input.request,
    context: {
      internalAdapter: {
        findCredentialAccount: vi.fn(async () => input.credential),
        findUserById: vi.fn(async () => input.user ?? USER),
      },
    },
  }
}

beforeEach(() => {
  sendMock.mockReset()
  sendMock.mockResolvedValue({
    ok: true,
    status: 200,
    error: null,
    reason: null,
  })
  localeMock.mockReset()
  localeMock.mockResolvedValue("es")
  logMock.mockReset()
  process.env.BETTER_AUTH_URL = "https://resender.dev"
})

afterEach(() => {
  delete process.env.BETTER_AUTH_URL
})

describe("shouldNotifyAccountLinked", () => {
  it("avisa cuando Google se suma a una cuenta que ya tenía contraseña", async () => {
    const adapter = { findCredentialAccount: async () => ({ id: "cred-1" }) }
    expect(
      await shouldNotifyAccountLinked(
        { providerId: "google", userId: "user-1" },
        adapter
      )
    ).toBe(true)
  })

  it("no avisa en el alta por Google: no hay credencial previa", async () => {
    const adapter = { findCredentialAccount: async () => null }
    expect(
      await shouldNotifyAccountLinked(
        { providerId: "google", userId: "user-1" },
        adapter
      )
    ).toBe(false)
  })

  it("no avisa al crear la fila credential de un alta normal, sin mirar la base", async () => {
    const findCredentialAccount = vi.fn(async () => ({ id: "cred-1" }))
    expect(
      await shouldNotifyAccountLinked(
        { providerId: "credential", userId: "user-1" },
        { findCredentialAccount }
      )
    ).toBe(false)
    expect(findCredentialAccount).not.toHaveBeenCalled()
  })
})

describe("notifyAccountLinked", () => {
  it("manda el aviso al correo de la cuenta con el enlace a /forgot-password", async () => {
    const ctx = makeCtx({ credential: { id: "cred-1" } })
    await notifyAccountLinked({ providerId: "google", userId: "user-1" }, ctx)

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith({
      to: "ada@example.com",
      locale: "es",
      // El `accountId` de la fila es el `sub` de Google, no la dirección:
      // el correo que se muestra es el de la cuenta, que es el mismo porque
      // la librería solo vincula cuando coinciden.
      googleEmail: "ada@example.com",
      forgotPasswordUrl: "https://resender.dev/forgot-password",
    })
    expect(logMock).not.toHaveBeenCalled()
  })

  it("resuelve el idioma con el request del callback y prefija /en", async () => {
    localeMock.mockResolvedValue("en")
    const request = new Request("http://localhost/api/auth/callback/google", {
      headers: { cookie: "lang=en" },
    })
    const ctx = makeCtx({ credential: { id: "cred-1" }, request })
    await notifyAccountLinked({ providerId: "google", userId: "user-1" }, ctx)

    expect(localeMock).toHaveBeenCalledWith(request)
    expect(sendMock.mock.calls[0]![0]).toMatchObject({
      locale: "en",
      forgotPasswordUrl: "https://resender.dev/en/forgot-password",
    })
  })

  it("no avisa en el alta por Google (sin credencial)", async () => {
    const ctx = makeCtx({ credential: null })
    await notifyAccountLinked({ providerId: "google", userId: "user-1" }, ctx)
    expect(sendMock).not.toHaveBeenCalled()
    expect(logMock).not.toHaveBeenCalled()
  })

  it("no avisa al crear la fila credential, ni con contexto nulo", async () => {
    await notifyAccountLinked(
      { providerId: "credential", userId: "user-1" },
      null
    )
    const ctx = makeCtx({ credential: { id: "cred-1" } })
    await notifyAccountLinked(
      { providerId: "credential", userId: "user-1" },
      ctx
    )
    expect(sendMock).not.toHaveBeenCalled()
    expect(
      ctx.context.internalAdapter.findCredentialAccount
    ).not.toHaveBeenCalled()
    expect(logMock).not.toHaveBeenCalled()
  })

  it("no propaga cuando el envío lanza: el login ya era exitoso", async () => {
    sendMock.mockRejectedValue(new Error("resend down"))
    const ctx = makeCtx({ credential: { id: "cred-1" } })
    await expect(
      notifyAccountLinked({ providerId: "google", userId: "user-1" }, ctx)
    ).resolves.toBeUndefined()

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email_send",
        outcome: "failed",
        reason: "internal_error",
        tenantId: "user-1",
        errorMessage: "resend down",
      })
    )
  })

  it("registra el fallo cuando el envío devuelve error, sin lanzar", async () => {
    sendMock.mockResolvedValue({
      ok: false,
      status: 502,
      error: "bad gateway",
      reason: "http_error",
    })
    const ctx = makeCtx({ credential: { id: "cred-1" } })
    await notifyAccountLinked({ providerId: "google", userId: "user-1" }, ctx)

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email_send",
        outcome: "failed",
        reason: "http_error",
        status: 502,
      })
    )
  })

  it("no propaga cuando la consulta de la credencial lanza", async () => {
    const ctx = makeCtx({ credential: null })
    ctx.context.internalAdapter.findCredentialAccount = vi.fn(async () => {
      throw new Error("db down")
    })
    await expect(
      notifyAccountLinked({ providerId: "google", userId: "user-1" }, ctx)
    ).resolves.toBeUndefined()
    expect(sendMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", errorMessage: "db down" })
    )
  })

  it("sin BETTER_AUTH_URL no manda nada y lo deja en el log", async () => {
    delete process.env.BETTER_AUTH_URL
    const ctx = makeCtx({ credential: { id: "cred-1" } })
    await notifyAccountLinked({ providerId: "google", userId: "user-1" }, ctx)
    expect(sendMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", reason: "not_configured" })
    )
  })

  it("con Google y sin contexto no rompe: lo registra y sale", async () => {
    await notifyAccountLinked({ providerId: "google", userId: "user-1" }, null)
    expect(sendMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", reason: "internal_error" })
    )
  })
})
