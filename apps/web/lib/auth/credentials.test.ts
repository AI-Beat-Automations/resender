import { readFile } from "node:fs/promises"

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateCredentials: vi.fn(),
}))

vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return {
    ...original,
    authenticateCredentials: mocks.authenticateCredentials,
  }
})

import {
  BackendProtocolError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { authorizeCredentials } from "./credentials"

const USER = {
  id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
  email: "person@example.com",
  waitlisted: false,
  createdAt: "2026-07-30T18:00:00.000Z",
}

describe("Credentials authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls backend authentication and returns only the minimal JWT user", async () => {
    mocks.authenticateCredentials.mockResolvedValue({
      ...USER,
      waitlisted: true,
    })

    const user = await authorizeCredentials(
      " PERSON@EXAMPLE.COM ",
      "correct-password"
    )

    expect(mocks.authenticateCredentials).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "correct-password",
    })
    expect(user).toEqual({
      id: USER.id,
      email: "person@example.com",
    })
    expect(user).not.toHaveProperty("waitlisted")
    expect(user).not.toHaveProperty("createdAt")
  })

  it.each(["unknown", "wrong password", "deleted"] as const)(
    "returns the same null result for an %s account",
    async () => {
      mocks.authenticateCredentials.mockResolvedValue(null)

      await expect(
        authorizeCredentials("person@example.com", "candidate-password")
      ).resolves.toBeNull()
    }
  )

  it.each([
    ["malformed email", "not-an-email", "long-enough"],
    ["oversized email", `${"a".repeat(309)}@example.com`, "long-enough"],
    ["short password", "person@example.com", "1234567"],
    ["oversized password", "person@example.com", "a".repeat(1025)],
  ])(
    "rejects %s before backend authentication",
    async (_name, email, password) => {
      await expect(authorizeCredentials(email, password)).resolves.toBeNull()
      expect(mocks.authenticateCredentials).not.toHaveBeenCalled()
    }
  )

  it.each([new BackendUnavailableError(), new BackendProtocolError()])(
    "fails closed for sanitized backend failures",
    async (error) => {
      mocks.authenticateCredentials.mockRejectedValue(error)

      await expect(
        authorizeCredentials("person@example.com", "candidate-password")
      ).rejects.toBe(error)
    }
  )

  it("keeps JWT/session callbacks minimal and never analyzes credential bodies", async () => {
    const authSource = await readFile(
      new URL("../../auth.ts", import.meta.url),
      "utf8"
    )

    expect(authSource).toContain("if (user?.id) token.id = user.id")
    expect(authSource).toContain(
      "session.user.id = String(token.id ?? token.sub)"
    )
    expect(authSource).not.toMatch(
      /token\.(?:password|passwordHash|waitlisted)|session\.user\.(?:password|passwordHash|waitlisted)/u
    )
    expect(authSource).not.toMatch(/console\.|capture\([^)]*password/isu)
  })
})
