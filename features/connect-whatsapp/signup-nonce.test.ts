import { describe, expect, it } from "vitest"

import {
  bindNonceToTenant,
  consumeSignupNonce,
  constantTimeEquals,
  generateSignupNonce,
  issueSignupNonce,
  SIGNUP_NONCE_COOKIE,
  SIGNUP_NONCE_COOKIE_OPTIONS,
  type SignupNonceCookieStore,
} from "./signup-nonce"

// Almacén de cookies de mentira, con la misma superficie que el de Next.
function fakeStore(initial?: string) {
  const jar = new Map<string, string>()
  if (initial !== undefined) jar.set(SIGNUP_NONCE_COOKIE, initial)

  const store: SignupNonceCookieStore & { jar: Map<string, string> } = {
    jar,
    get: (name) => {
      const value = jar.get(name)
      return value === undefined ? undefined : { value }
    },
    set: (name, value) => jar.set(name, value),
    delete: (name) => jar.delete(name),
  }
  return store
}

describe("issueSignupNonce", () => {
  it("siembra el nonce atado al tenant y devuelve solo el secreto", () => {
    const store = fakeStore()
    const nonce = issueSignupNonce(store, "tenant-1")

    expect(nonce).not.toContain("tenant-1")
    expect(store.jar.get(SIGNUP_NONCE_COOKIE)).toBe(
      bindNonceToTenant("tenant-1", nonce)
    )
  })

  it("la cookie es httpOnly, secure y de vida corta", () => {
    // No es decoración: el launcher no tiene que poder leerla, y una cookie sin
    // caducidad convierte un secreto de sesión en uno permanente.
    expect(SIGNUP_NONCE_COOKIE_OPTIONS.httpOnly).toBe(true)
    expect(SIGNUP_NONCE_COOKIE_OPTIONS.secure).toBe(true)
    expect(SIGNUP_NONCE_COOKIE_OPTIONS.sameSite).toBe("lax")
    expect(SIGNUP_NONCE_COOKIE_OPTIONS.maxAge).toBe(600)
  })

  it("no repite el nonce entre emisiones", () => {
    expect(generateSignupNonce()).not.toBe(generateSignupNonce())
  })
})

describe("consumeSignupNonce", () => {
  it("acepta el nonce que emitió este mismo tenant", () => {
    const store = fakeStore()
    const nonce = issueSignupNonce(store, "tenant-1")

    expect(consumeSignupNonce(store, "tenant-1", nonce)).toBe(true)
  })

  it("lo consume: el segundo intento con el mismo nonce falla", () => {
    const store = fakeStore()
    const nonce = issueSignupNonce(store, "tenant-1")

    expect(consumeSignupNonce(store, "tenant-1", nonce)).toBe(true)
    expect(consumeSignupNonce(store, "tenant-1", nonce)).toBe(false)
  })

  it("borra la cookie también cuando no coincide", () => {
    // Si solo se borrara al acertar, un atacante tendría intentos ilimitados
    // contra la misma cookie.
    const store = fakeStore()
    issueSignupNonce(store, "tenant-1")

    expect(consumeSignupNonce(store, "tenant-1", "otro")).toBe(false)
    expect(store.jar.has(SIGNUP_NONCE_COOKIE)).toBe(false)
  })

  it("no vale para otro tenant que use el mismo navegador", () => {
    // La cookie sobrevive a un cambio de sesión; la atadura al tenant es lo que
    // impide que el nonce de una cuenta cierre el onboarding de la siguiente.
    const store = fakeStore()
    const nonce = issueSignupNonce(store, "tenant-1")

    expect(consumeSignupNonce(store, "tenant-2", nonce)).toBe(false)
  })

  it("rechaza el cierre sin cookie y el cierre sin nonce", () => {
    expect(consumeSignupNonce(fakeStore(), "tenant-1", "algo")).toBe(false)

    const store = fakeStore()
    issueSignupNonce(store, "tenant-1")
    expect(consumeSignupNonce(store, "tenant-1", null)).toBe(false)
  })
})

describe("constantTimeEquals", () => {
  it("compara sin lanzar cuando las longitudes difieren", () => {
    expect(constantTimeEquals("abc", "abcd")).toBe(false)
    expect(constantTimeEquals("abc", "abc")).toBe(true)
    expect(constantTimeEquals("", "")).toBe(true)
  })
})
