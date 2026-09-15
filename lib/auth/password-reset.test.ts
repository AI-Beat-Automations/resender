import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock("@/lib/db", () => ({ getSql: () => sqlMock }))

import { peekResetToken, resetTokenIdentifier } from "./password-reset"

// El **formato** del identifier lo vigila `password-reset.contract.test.ts`
// contra una instancia real de la librería. Acá solo se prueba el peek: que
// mande la consulta que dice mandar y que traduzca el resultado.
describe("peekResetToken", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
  })

  it("dice que el enlace vive cuando hay fila", async () => {
    sqlMock.mockResolvedValue([{ id: "verification-1" }])
    expect(await peekResetToken("token-vivo")).toBe(true)
  })

  it("dice que no vive cuando la consulta no devuelve nada", async () => {
    // Es el mismo resultado para el token que nunca existió, el que ya se usó
    // —`resetPassword` borra la fila— y el que venció, porque la consulta
    // filtra por `expires_at > now()`.
    expect(await peekResetToken("token-muerto")).toBe(false)
  })

  it("busca por el identifier de la librería y no consume nada", async () => {
    await peekResetToken("abc123")

    const [strings, ...params] = sqlMock.mock.calls[0]!
    expect(params).toContain(resetTokenIdentifier("abc123"))
    const query = (strings as string[]).join("")
    expect(query).toContain("auth_verifications")
    expect(query).toContain("expires_at > now()")
    // De solo lectura: la autoridad sobre el token es `resetPassword`.
    expect(query.toLowerCase()).not.toContain("delete")
    expect(query.toLowerCase()).not.toContain("update")
  })

  it("no consulta con un token vacío", async () => {
    expect(await peekResetToken("")).toBe(false)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})
