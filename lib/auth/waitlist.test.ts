import { describe, expect, it } from "vitest"

import { decideProductAccess, hasProductAccess } from "./waitlist"

describe("waitlist access", () => {
  it("grants access only when the flag is explicitly false", () => {
    expect(hasProductAccess({ waitlisted: false })).toBe(true)
  })

  it("denies access to a waitlisted account", () => {
    expect(hasProductAccess({ waitlisted: true })).toBe(false)
  })

  it("fails closed when the user row is missing", () => {
    expect(hasProductAccess(null)).toBe(false)
    expect(hasProductAccess(undefined)).toBe(false)
  })
})

describe("decideProductAccess", () => {
  it("distingue la cuenta en lista de espera de la sesión huérfana", () => {
    expect(decideProductAccess({ waitlisted: true })).toBe("waitlisted")
    expect(decideProductAccess(null)).toBe("unknown_user")
    expect(decideProductAccess(undefined)).toBe("unknown_user")
  })

  it("permite entrar solo con la bandera explícitamente en false", () => {
    expect(decideProductAccess({ waitlisted: false })).toBe("allowed")
  })

  // La distinción existe para romper un rebote infinito: cuando el gate y la
  // pantalla de login trataban igual a las dos, una sesión firmada cuyo usuario
  // no está en la base iba de `/connections` a `/login` y de vuelta sin parar.
  it("no deja que una sesión huérfana pase por lista de espera", () => {
    expect(decideProductAccess(null)).not.toBe("waitlisted")
  })
})
