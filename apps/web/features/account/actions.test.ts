import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signOut: vi.fn(),
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth, signOut: mocks.signOut }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return {
    ...original,
    changePassword: mocks.changePassword,
    deleteAccount: mocks.deleteAccount,
  }
})

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { changePasswordAction, deleteAccountAction } from "./actions"

const ACTOR_ID = "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
const REDIRECT = new Error("NEXT_REDIRECT")

describe("Account Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: ACTOR_ID } })
    mocks.signOut.mockImplementation(() => {
      throw REDIRECT
    })
    mocks.redirect.mockImplementation(() => {
      throw REDIRECT
    })
  })

  it("authenticates password and deletion actions independently", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(changePasswordAction({}, passwordForm())).resolves.toEqual({
      error: "No hay sesión iniciada.",
    })
    await expect(deleteAccountAction({}, deleteForm())).resolves.toEqual({
      error: "No hay sesión iniciada.",
    })
    expect(mocks.auth).toHaveBeenCalledTimes(2)
    expect(mocks.changePassword).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it.each([
    ["short", "short", "short", /al menos 8/u],
    ["mismatch", "long-enough", "different-password", /no coinciden/u],
    ["too long", "a".repeat(1025), "a".repeat(1025), /1024/u],
  ])(
    "rejects a %s password before RPC",
    async (_name, password, confirm, copy) => {
      const result = await changePasswordAction(
        {},
        passwordForm(password, confirm)
      )

      expect(result.error).toMatch(copy)
      expect(mocks.changePassword).not.toHaveBeenCalled()
      expect(mocks.signOut).not.toHaveBeenCalled()
    }
  )

  it("changes the password through RPC then signs out to the existing safe notice", async () => {
    mocks.changePassword.mockResolvedValue(undefined)

    await expect(changePasswordAction({}, passwordForm())).rejects.toBe(
      REDIRECT
    )
    expect(mocks.changePassword).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { newPassword: "long-enough" }
    )
    expect(mocks.signOut).toHaveBeenCalledWith({
      redirectTo: "/login?passwordChanged=1",
    })
  })

  it.each([
    [
      rpcError("validation_error", "validation", 400),
      "No pudimos guardar esa contraseña.",
    ],
    [rpcError("not_found", "not_found", 404), "No encontramos la cuenta."],
  ] as const)("returns controlled password errors", async (error, copy) => {
    mocks.changePassword.mockRejectedValue(error)

    await expect(changePasswordAction({}, passwordForm())).resolves.toEqual({
      error: copy,
    })
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("validates deletion confirmation before RPC", async () => {
    await expect(
      deleteAccountAction({}, deleteForm("not-an-email"))
    ).resolves.toMatchObject({ error: expect.stringMatching(/email/u) })
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("does not sign out when the backend cannot confirm local deletion", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    mocks.deleteAccount.mockResolvedValue({
      deleted: false,
      metaUnsubscribeFailures: 2,
      stripeCancellationFailed: true,
    })

    const result = await deleteAccountAction({}, deleteForm())

    expect(mocks.deleteAccount).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { confirmEmail: "person@example.com" }
    )
    expect(result.error).toMatch(/cuenta.*datos.*sesión.*soporte/u)
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith("Account deletion outcome.", {
      deleted: false,
      metaUnsubscribeFailures: 2,
      stripeCancellationFailed: true,
    })
    expect(JSON.stringify(info.mock.calls)).not.toMatch(
      /stripeSubscriptionId|pageAccessToken|sub_|SECRET|token/u
    )
    info.mockRestore()
  })

  it.each([
    [0, false],
    [2, true],
  ] as const)(
    "signs out after confirmed deletion even with cleanup result %s/%s",
    async (metaUnsubscribeFailures, stripeCancellationFailed) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
      mocks.deleteAccount.mockResolvedValue({
        deleted: true,
        metaUnsubscribeFailures,
        stripeCancellationFailed,
      })

      await expect(deleteAccountAction({}, deleteForm())).rejects.toBe(REDIRECT)

      expect(info).toHaveBeenCalledWith("Account deletion outcome.", {
        deleted: true,
        metaUnsubscribeFailures,
        stripeCancellationFailed,
      })
      expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/" })
      info.mockRestore()
    }
  )

  it.each([
    [rpcError("validation_error", "validation", 400), /email no coincide/u],
    [rpcError("not_found", "not_found", 404), /No encontramos la cuenta/u],
  ] as const)("returns controlled deletion errors", async (error, copy) => {
    mocks.deleteAccount.mockRejectedValue(error)

    const result = await deleteAccountAction({}, deleteForm())

    expect(result.error).toMatch(copy)
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)(
    "redirects account access races outside catches",
    async (error, destination) => {
      mocks.deleteAccount.mockRejectedValue(error)

      await expect(deleteAccountAction({}, deleteForm())).rejects.toBe(REDIRECT)
      expect(mocks.redirect).toHaveBeenCalledWith(destination)
      expect(mocks.signOut).not.toHaveBeenCalled()
    }
  )

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("internal_error", "internal", 500),
    rpcError("provider_unavailable", "transient", 502),
  ])(
    "fails closed without signout for backend/protocol failures",
    async (error) => {
      mocks.deleteAccount.mockRejectedValue(error)

      await expect(deleteAccountAction({}, deleteForm())).rejects.toBe(error)
      expect(mocks.signOut).not.toHaveBeenCalled()
    }
  )
})

function passwordForm(password = "long-enough", confirmPassword = password) {
  const form = new FormData()
  form.set("newPassword", password)
  form.set("confirmPassword", confirmPassword)
  return form
}

function deleteForm(email = "person@example.com") {
  const form = new FormData()
  form.set("confirmEmail", email)
  return form
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "not_found"
    | "validation_error"
    | "internal_error"
    | "provider_unavailable",
  kind: "access" | "not_found" | "validation" | "internal" | "transient",
  status: 400 | 403 | 404 | 500 | 502
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: kind === "transient",
  })
}
