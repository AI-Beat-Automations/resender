import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock("@/lib/db", () => ({ getSql: () => sqlMock }))

import { decideEmailVerified, isEmailVerified } from "./email-verified"

describe("decideEmailVerified", () => {
  it("es falso sin fila: la cuenta borrada con sesión viva no está confirmada", () => {
    expect(decideEmailVerified(null)).toBe(false)
    expect(decideEmailVerified(undefined)).toBe(false)
  })

  it("es falso con la bandera en false", () => {
    expect(decideEmailVerified({ email_verified: false })).toBe(false)
  })

  it("es verdadero solo con la bandera en true", () => {
    expect(decideEmailVerified({ email_verified: true })).toBe(true)
  })

  it("no confía en valores que no sean exactamente true", () => {
    // Fail closed: un driver que devolviera `"t"` o `1` no abre la puerta.
    expect(
      decideEmailVerified({ email_verified: "t" as unknown as boolean })
    ).toBe(false)
    expect(
      decideEmailVerified({ email_verified: 1 as unknown as boolean })
    ).toBe(false)
  })
})

describe("isEmailVerified", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
  })

  it("lee email_verified vivo de users por id", async () => {
    sqlMock.mockResolvedValue([{ email_verified: true }])
    expect(await isEmailVerified("user-1")).toBe(true)

    const [strings, ...params] = sqlMock.mock.calls[0]!
    const query = (strings as string[]).join("").toLowerCase()
    expect(query).toContain("email_verified")
    expect(query).toContain("from users")
    expect(params).toContain("user-1")
  })

  it("es falso cuando la consulta no devuelve nada", async () => {
    expect(await isEmailVerified("nadie")).toBe(false)
  })
})
