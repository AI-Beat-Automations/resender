import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { authMock, exchangeMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  exchangeMock: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: authMock }))
vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return { ...original, exchangeMetaAuthorizationCode: exchangeMock }
})

import {
  BackendRpcError,
  BackendProtocolError,
  BackendUnavailableError,
} from "@/lib/backend/backend"
import { serializeMetaState } from "@/lib/meta/oauth"

import { GET } from "./route"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const STATE = "5e052bb8-a52b-40b7-bc03-39fd193f6f50"

describe("GET /api/meta/callback", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://resender.dev"
    process.env.AUTH_SECRET = "test-only-state-signing-secret"
    authMock.mockResolvedValue({ user: { id: USER_ID } })
    exchangeMock.mockResolvedValue({ authorized: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
    Reflect.deleteProperty(process.env, "APP_URL")
    Reflect.deleteProperty(process.env, "AUTH_SECRET")
  })

  it("consumes fresh state before RPC and sends the exact configured redirect URI", async () => {
    const request = callbackRequest({ code: "secret-code", state: STATE })
    exchangeMock.mockImplementation(async () => {
      expect(request.cookies.get("meta_oauth_state")).toBeUndefined()
      return { authorized: true }
    })

    const response = await GET(request)

    expect(exchangeMock).toHaveBeenCalledWith(
      { userId: USER_ID },
      {
        code: "secret-code",
        redirectUri: "https://resender.dev/api/meta/callback",
      }
    )
    expect(response.headers.get("location")).toBe(
      "https://resender.dev/connections/select"
    )
    expect(response.headers.get("set-cookie")).toMatch(
      /meta_oauth_state=; Path=\/; Max-Age=0; Secure; HttpOnly; SameSite=lax/iu
    )
  })

  it.each([
    [{ code: "code" }, "state_missing"],
    [
      { code: "code", state: "4ed23e02-b81b-46aa-aec5-bca3fa2470e8" },
      "state_mismatch",
    ],
  ] as const)("rejects invalid state before RPC", async (query, reason) => {
    const response = await GET(callbackRequest(query))

    expect(exchangeMock).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toBe(
      `https://resender.dev/connections?meta=error&reason=${reason}`
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("rejects expired state and a sequential replay before RPC", async () => {
    const expired = callbackRequest(
      { code: "code", state: STATE },
      Date.now() - 601_000
    )
    expect((await GET(expired)).headers.get("location")).toContain(
      "reason=state_expired"
    )

    const replay = callbackRequest(
      { code: "code", state: STATE },
      undefined,
      false
    )
    expect((await GET(replay)).headers.get("location")).toContain(
      "reason=state_missing"
    )
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it("never reflects provider error, code, or state in a redirect", async () => {
    const marker = "DO_NOT_REFLECT"
    const response = await GET(
      callbackRequest({
        code: marker,
        state: STATE,
        error: marker,
        error_description: marker,
      })
    )
    const location = response.headers.get("location") ?? ""
    expect(location).toContain("reason=provider_cancelled")
    expect(location).not.toContain(marker)
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it("rejects a missing authorization code after consuming valid state", async () => {
    const response = await GET(callbackRequest({ state: STATE }))

    expect(exchangeMock).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toContain("reason=missing_code")
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("clears state without exposing a missing signing-secret configuration", async () => {
    const request = callbackRequest({ code: "code", state: STATE })
    Reflect.deleteProperty(process.env, "AUTH_SECRET")
    const response = await GET(request)

    expect(exchangeMock).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toContain("reason=backend_invalid")
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it.each([
    [
      new BackendRpcError({
        kind: "provider",
        code: "provider_rejected",
        status: 502,
        retryable: false,
      }),
      "meta_session_expired",
    ],
    [new BackendProtocolError(), "backend_invalid"],
    [new BackendUnavailableError(), "backend_unavailable"],
  ])("sanitizes exchange failures", async (error, reason) => {
    exchangeMock.mockRejectedValue(error)
    const response = await GET(callbackRequest({ code: "code", state: STATE }))

    const location = response.headers.get("location") ?? ""
    expect(location).toContain(`reason=${reason}`)
    expect(location).not.toContain("code")
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("clears state and returns a fixed error for an unexpected post-state failure", async () => {
    exchangeMock.mockRejectedValue(new Error("secret provider body"))
    const response = await GET(callbackRequest({ code: "code", state: STATE }))

    expect(response.headers.get("location")).toContain("reason=exchange_failed")
    expect(response.headers.get("location")).not.toContain(
      "secret provider body"
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })
})

function callbackRequest(
  query: Record<string, string>,
  issuedAt = Date.now(),
  includeCookie = true
) {
  const url = new URL("https://attacker-controlled.example/api/meta/callback")
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  const headers = new Headers()
  if (includeCookie) {
    headers.set(
      "cookie",
      `meta_oauth_state=${serializeMetaState(STATE, issuedAt)}`
    )
  }
  return new NextRequest(url, { headers })
}
