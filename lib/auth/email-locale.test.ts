import { beforeEach, describe, expect, it, vi } from "vitest"

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }))

vi.mock("next/headers", () => ({ cookies: cookiesMock }))

import { localeFromCookieHeader, resolveEmailLocale } from "./email-locale"

function cookieStore(value: string | undefined) {
  return { get: (name: string) => (name === "lang" ? { value } : undefined) }
}

describe("localeFromCookieHeader", () => {
  it("lee la cookie lang, que es la del producto (no NEXT_LOCALE)", () => {
    expect(localeFromCookieHeader("lang=en")).toBe("en")
    expect(localeFromCookieHeader("NEXT_LOCALE=en")).toBeNull()
  })

  it("la encuentra entre otras cookies, con espacios y codificada", () => {
    expect(
      localeFromCookieHeader("__Secure-better-auth.session_token=abc; lang=en")
    ).toBe("en")
    expect(localeFromCookieHeader("a=1;lang=%65%73;b=2")).toBe("es")
  })

  it("ignora valores que no son un idioma conocido", () => {
    expect(localeFromCookieHeader("lang=fr")).toBeNull()
    expect(localeFromCookieHeader("lang=")).toBeNull()
    expect(localeFromCookieHeader("lang=%E0%A4%A")).toBeNull()
  })

  it("no confunde una cookie que solo empieza igual", () => {
    expect(localeFromCookieHeader("language=en")).toBeNull()
  })

  it("es null sin header", () => {
    expect(localeFromCookieHeader(null)).toBeNull()
    expect(localeFromCookieHeader(undefined)).toBeNull()
    expect(localeFromCookieHeader("")).toBeNull()
  })
})

describe("resolveEmailLocale", () => {
  beforeEach(() => {
    cookiesMock.mockReset()
  })

  it("prefiere la cookie del request cuando la llamada entró por HTTP", async () => {
    cookiesMock.mockResolvedValue(cookieStore("es"))
    const request = new Request("http://localhost/api/auth/callback/google", {
      headers: { cookie: "lang=en" },
    })
    expect(await resolveEmailLocale(request)).toBe("en")
    expect(cookiesMock).not.toHaveBeenCalled()
  })

  it("cae en cookies() de Next cuando no hay request (server action)", async () => {
    cookiesMock.mockResolvedValue(cookieStore("en"))
    expect(await resolveEmailLocale()).toBe("en")
  })

  it("cae en cookies() de Next si el request no trae la cookie", async () => {
    cookiesMock.mockResolvedValue(cookieStore("en"))
    const request = new Request("http://localhost/api/auth/verify-email")
    expect(await resolveEmailLocale(request)).toBe("en")
  })

  it("es 'es' cuando cookies() lanza fuera de una request de Next", async () => {
    cookiesMock.mockRejectedValue(new Error("outside request scope"))
    expect(await resolveEmailLocale(null)).toBe("es")
  })

  it("es 'es' cuando ninguna fuente trae un idioma válido", async () => {
    cookiesMock.mockResolvedValue(cookieStore(undefined))
    expect(await resolveEmailLocale()).toBe("es")
  })
})
