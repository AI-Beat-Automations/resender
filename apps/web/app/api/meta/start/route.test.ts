import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { authMock, accessMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  accessMock: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: authMock }))
vi.mock("@/lib/backend/backend", () => ({ getProductAccess: accessMock }))

import { GET } from "./route"

const USER_ID = "11111111-1111-4111-8111-111111111111"

describe("GET /api/meta/start", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://resender.dev"
    process.env.NEXT_PUBLIC_META_APP_ID = "app_123"
    process.env.NEXT_PUBLIC_META_CONFIG_ID = "config_123"
    process.env.AUTH_SECRET = "test-only-state-signing-secret"
    authMock.mockResolvedValue({ user: { id: USER_ID } })
    accessMock.mockResolvedValue({
      userExists: true,
      waitlisted: false,
      subscriptionActive: true,
      destination: "product",
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    Reflect.deleteProperty(process.env, "APP_URL")
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_APP_ID")
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_CONFIG_ID")
    Reflect.deleteProperty(process.env, "AUTH_SECRET")
  })

  it("gates through BACKEND and seeds a secure browser-only state cookie", async () => {
    const response = await GET()
    const location = new URL(response.headers.get("location")!)
    const state = location.searchParams.get("state")

    expect(accessMock).toHaveBeenCalledWith({ userId: USER_ID })
    expect(location.origin).toBe("https://www.facebook.com")
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://resender.dev/api/meta/callback"
    )
    expect(state).toMatch(/^[0-9a-f-]{36}$/iu)
    const cookie = response.headers.get("set-cookie") ?? ""
    expect(cookie).toMatch(
      /^meta_oauth_state=[0-9]{13}\.[^.]+\.[A-Za-z0-9_-]{43};/u
    )
    expect(cookie).toContain("Path=/")
    expect(cookie).toContain("Max-Age=600")
    expect(cookie).toContain("Secure")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=lax")
    expect(cookie).toContain("Priority=high")
  })

  it("uses APP_URL, not request host, for access redirects", async () => {
    accessMock.mockResolvedValue({
      userExists: true,
      waitlisted: false,
      subscriptionActive: false,
      destination: "billing",
    })

    expect((await GET()).headers.get("location")).toBe(
      "https://resender.dev/billing"
    )
  })
})
