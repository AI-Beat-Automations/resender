import { readFile } from "node:fs/promises"

import { CredentialsSignin } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
}))

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  registerUser: vi.fn(),
}))

vi.mock("@/auth", () => ({ signIn: mocks.signIn }))
vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return {
    ...original,
    registerUser: mocks.registerUser,
  }
})

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { loginAction, registerAction } from "./actions"

const USER = {
  id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
  email: "person@example.com",
  waitlisted: false,
  createdAt: "2026-07-30T18:00:00.000Z",
}

describe("Auth Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.signIn.mockResolvedValue(undefined)
    mocks.registerUser.mockResolvedValue(USER)
  })

  it("normalizes valid login credentials and preserves the redirect", async () => {
    await expect(
      loginAction({}, authForm(" PERSON@EXAMPLE.COM ", "correct-password"))
    ).resolves.toEqual({})

    expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
      email: "person@example.com",
      password: "correct-password",
      redirectTo: "/connections",
    })
  })

  it.each([
    ["unknown", new CredentialsSignin()],
    ["wrong password", new CredentialsSignin()],
    ["deleted", new CredentialsSignin()],
  ] as const)(
    "returns the same public login error for %s credentials",
    async (_name, error) => {
      mocks.signIn.mockRejectedValue(error)

      await expect(
        loginAction({}, authForm("person@example.com", "candidate-password"))
      ).resolves.toEqual({ error: "Email o contraseña incorrectos." })
    }
  )

  it("rejects malformed login input with the same generic message", async () => {
    await expect(
      loginAction({}, authForm("not-an-email", "short"))
    ).resolves.toEqual({ error: "Email o contraseña incorrectos." })
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it.each([new BackendUnavailableError(), new BackendProtocolError()])(
    "does not turn an operational login failure into bad credentials",
    async (error) => {
      mocks.signIn.mockRejectedValue(error)

      await expect(
        loginAction({}, authForm("person@example.com", "candidate-password"))
      ).rejects.toBe(error)
    }
  )

  it.each([
    ["minimum", "12345678"],
    ["maximum", "a".repeat(1024)],
  ])(
    "registers a valid %s-bound password through RPC",
    async (_name, password) => {
      await expect(
        registerAction({}, authForm(" PERSON@EXAMPLE.COM ", password))
      ).resolves.toEqual({})

      expect(mocks.registerUser).toHaveBeenCalledWith({
        email: "person@example.com",
        password,
      })
      expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
        email: "person@example.com",
        password,
        redirectTo: "/connections",
      })
    }
  )

  it("signs in a newly registered waitlisted user", async () => {
    mocks.registerUser.mockResolvedValue({ ...USER, waitlisted: true })

    await registerAction({}, authForm("person@example.com", "correct-password"))

    expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
      email: "person@example.com",
      password: "correct-password",
      redirectTo: "/connections",
    })
  })

  it.each([
    ["malformed email", "not-an-email", "long-enough"],
    ["oversized email", `${"a".repeat(309)}@example.com`, "long-enough"],
    ["short password", "person@example.com", "1234567"],
    ["oversized password", "person@example.com", "a".repeat(1025)],
    ["missing password", "person@example.com", null],
  ])("rejects %s registration before RPC", async (_name, email, password) => {
    const result = await registerAction({}, authForm(email, password, "es"))

    expect(result.error).toBeTruthy()
    expect(mocks.registerUser).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it("keeps duplicate registration explicit", async () => {
    mocks.registerUser.mockRejectedValue(
      new BackendRpcError({
        kind: "validation",
        code: "validation_error",
        status: 409,
        retryable: false,
      })
    )

    await expect(
      registerAction(
        {},
        authForm("person@example.com", "correct-password", "en")
      )
    ).resolves.toEqual({
      error: "That email is already registered. Sign in.",
    })
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    new BackendRpcError({
      kind: "internal",
      code: "internal_error",
      status: 500,
      retryable: false,
    }),
  ])("hard-fails sanitized registration errors", async (error) => {
    mocks.registerUser.mockRejectedValue(error)

    await expect(
      registerAction({}, authForm("person@example.com", "candidate-password"))
    ).rejects.toBe(error)
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(JSON.stringify(error)).not.toMatch(/password|database|secret/u)
  })

  it("keeps password and database helpers out of web auth consumers", async () => {
    const [actionsSource, credentialsSource] = await Promise.all([
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../../lib/auth/credentials.ts", import.meta.url),
        "utf8"
      ),
    ])
    const source = `${actionsSource}\n${credentialsSource}`

    expect(source).not.toMatch(
      /getSql|passwordHash|hashPassword|verifyPassword|console\./u
    )
  })
})

function authForm(
  email: string,
  password: string | null,
  locale: "es" | "en" = "es"
) {
  const form = new FormData()
  form.set("email", email)
  if (password !== null) form.set("password", password)
  form.set("locale", locale)
  return form
}
