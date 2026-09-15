import { afterEach, describe, expect, it, vi } from "vitest"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import {
  markXRegistration,
  readXRegistration,
  sendXRegistration,
  X_REGISTRATION_COOKIE,
  X_REGISTRATION_EVENT_ID,
} from "./x-registration"

const id = "12345678-1234-1234-1234-123456789abc"
afterEach(() => vi.unstubAllGlobals())

describe("registration receipt", () => {
  it.each(["", "resender_consent=denied"])(
    "does not mark without consent: %s",
    (cookie) => {
      const setCookie = vi.fn()
      markXRegistration({
        headers: new Headers({ cookie }),
        context: { baseURL: "https://resender.dev/api/auth" },
        setCookie,
      })
      expect(setCookie).not.toHaveBeenCalled()
    }
  )

  it("does not mark staging signups", () => {
    const setCookie = vi.fn()
    markXRegistration({
      headers: new Headers({ cookie: "resender_consent=granted" }),
      context: { baseURL: "https://staging.resender.dev" },
      setCookie,
    })
    expect(setCookie).not.toHaveBeenCalled()
  })

  it("survives a cookie failure without breaking signup", () => {
    expect(() =>
      markXRegistration({
        headers: new Headers({ cookie: "resender_consent=granted" }),
        context: { baseURL: "https://resender.dev" },
        setCookie: () => {
          throw new Error("cookie failure")
        },
      })
    ).not.toThrow()
  })

  it("Better Auth returns a receipt on creation, not login or duplicate signup", async () => {
    const auth = betterAuth({
      baseURL: "https://resender.dev",
      secret: "test-secret-for-registration-12345678901234567890",
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
      }),
      emailAndPassword: { enabled: true },
      databaseHooks: {
        user: {
          create: {
            after: async (_user, ctx) => {
              markXRegistration(ctx)
            },
          },
        },
      },
      rateLimit: { enabled: false },
    })
    const headers = new Headers({ cookie: "resender_consent=granted" })
    const body = {
      name: "Test",
      email: "registration@example.com",
      password: "test-password-123",
    }
    const signup = await auth.api.signUpEmail({
      body,
      headers,
      asResponse: true,
    })
    expect(signup.status).toBe(200)
    expect(signup.headers.get("set-cookie")).toContain(
      `${X_REGISTRATION_COOKIE}=`
    )
    const login = await auth.api.signInEmail({
      body,
      headers,
      asResponse: true,
    })
    expect(login.status).toBe(200)
    expect(login.headers.get("set-cookie") ?? "").not.toContain(
      X_REGISTRATION_COOKIE
    )
    const duplicate = await auth.api.signUpEmail({
      body,
      headers,
      asResponse: true,
    })
    expect(duplicate.headers.get("set-cookie") ?? "").not.toContain(
      X_REGISTRATION_COOKIE
    )
  })
})

function browser(consent = "granted", hostname = "resender.dev") {
  let cookie = `resender_consent=${consent}; ${X_REGISTRATION_COOKIE}=${id}`
  const twq = Object.assign(vi.fn(), { exe: vi.fn() as unknown })
  vi.stubGlobal("window", { location: { hostname }, twq })
  vi.stubGlobal("document", {
    get cookie() {
      return cookie
    },
    set cookie(value: string) {
      if (value.includes("max-age=0")) cookie = `resender_consent=${consent}`
    },
  })
  return twq
}

describe("registration delivery", () => {
  it("sends the configured event once, including after a reload", () => {
    const twq = browser()
    expect(sendXRegistration()).toBe(true)
    expect(twq).toHaveBeenCalledWith("event", X_REGISTRATION_EVENT_ID, {
      conversion_id: id,
    })
    expect(sendXRegistration()).toBe(false)
    expect(twq).toHaveBeenCalledTimes(1)
  })
  it("waits for the SDK and preserves the receipt if blocked", () => {
    const twq = browser()
    twq.exe = undefined
    expect(sendXRegistration()).toBe(false)
    expect(readXRegistration(document.cookie)).toBe(id)
    twq.exe = vi.fn()
    expect(sendXRegistration()).toBe(true)
  })
  it("discards the receipt if consent was withdrawn", () => {
    const twq = browser("denied")
    expect(sendXRegistration()).toBe(false)
    expect(twq).not.toHaveBeenCalled()
    expect(readXRegistration(document.cookie)).toBeNull()
  })
  it("never sends from staging", () => {
    const twq = browser("granted", "staging.resender.dev")
    expect(sendXRegistration()).toBe(false)
    expect(twq).not.toHaveBeenCalled()
  })
})
