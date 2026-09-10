import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { googleProvider, isGoogleEnabled, socialProviders } from "./google"

// Las dos variables se limpian antes y después de cada caso: el entorno de
// quien corre los tests no tiene que decidir el resultado.
beforeEach(() => {
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
})

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
})

describe("isGoogleEnabled", () => {
  it("es falso sin credenciales", () => {
    expect(isGoogleEnabled()).toBe(false)
  })

  it("es verdadero con las dos credenciales", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    expect(isGoogleEnabled()).toBe(true)
  })

  it("es falso con una sola de las dos", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    expect(isGoogleEnabled()).toBe(false)

    delete process.env.GOOGLE_CLIENT_ID
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    expect(isGoogleEnabled()).toBe(false)
  })

  it("trata la cadena vacía como ausente", () => {
    process.env.GOOGLE_CLIENT_ID = ""
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    expect(isGoogleEnabled()).toBe(false)
  })
})

describe("googleProvider", () => {
  it("devuelve clientId y clientSecret tal cual, sin scopes extra", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    // Solo esas dos claves: los scopes quedan en el default de la librería
    // (`openid`, `email`, `profile`), que no exige revisión de Google.
    expect(googleProvider()).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
    })
  })

  it("es undefined cuando falta una credencial", () => {
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    expect(googleProvider()).toBeUndefined()
  })
})

describe("socialProviders", () => {
  it("queda vacío cuando Google está apagado", () => {
    // Es la forma que `auth.ts` tenía antes del #98: sin credenciales nada
    // cambia y el build sigue pasando sin secretos.
    expect(socialProviders()).toEqual({})
  })

  it("registra google cuando hay credenciales", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    expect(Object.keys(socialProviders())).toEqual(["google"])
  })
})
