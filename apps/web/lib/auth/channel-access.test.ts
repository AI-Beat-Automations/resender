import { describe, expect, it } from "vitest"

import { hasInstagramAccess } from "./channel-access"

describe("instagram channel access", () => {
  it("grants access only when the flag is explicitly true", () => {
    expect(hasInstagramAccess({ instagram_enabled: true })).toBe(true)
  })

  it("denies access to an account without the permission", () => {
    expect(hasInstagramAccess({ instagram_enabled: false })).toBe(false)
  })

  it("fails closed when the user row is missing", () => {
    expect(hasInstagramAccess(null)).toBe(false)
    expect(hasInstagramAccess(undefined)).toBe(false)
  })

  // Una bandera que no es booleana solo puede venir de una fila que no es la
  // que creemos —driver que devuelve otra forma, columna renombrada—, y el
  // permiso tiene que cerrarse antes que asumir que el canal está habilitado.
  it("fails closed when the flag is unreadable", () => {
    expect(
      hasInstagramAccess({ instagram_enabled: null } as unknown as {
        instagram_enabled: boolean
      })
    ).toBe(false)
    expect(
      hasInstagramAccess({} as unknown as { instagram_enabled: boolean })
    ).toBe(false)
  })
})
