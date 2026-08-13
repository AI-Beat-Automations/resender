import { describe, expect, it } from "vitest"

import { evaluateAccountSlot } from "./account-allowance"

describe("evaluateAccountSlot", () => {
  it("deja conectar una cuenta nueva mientras quede cupo", () => {
    expect(
      evaluateAccountSlot({
        maxAccounts: 2,
        activeAccountCount: 1,
        existingStatus: null,
      })
    ).toEqual({ ok: true, reason: "new_slot" })
  })

  // El caso que hace que este módulo no sea `activeCount < max` a secas. En
  // Instagram el token vence a los ~60 días y reconectar es mantenimiento
  // rutinario: cobrarle un slot dejaría sin salida a quien esté en el tope, que
  // no podría renovar el token de una cuenta que ya tiene.
  it("permite re-autorizar una cuenta ya activa aunque el tenant esté en el tope", () => {
    expect(
      evaluateAccountSlot({
        maxAccounts: 2,
        activeAccountCount: 2,
        existingStatus: "active",
      })
    ).toEqual({ ok: true, reason: "reauthorization" })
  })

  // Una cuenta desconectada no ocupa cupo, pero reconectarla lo consume: misma
  // regla que en la pantalla de selección de Facebook (`page-selection.ts`).
  it("cobra un slot por reconectar una cuenta desconectada, y lo niega sin cupo", () => {
    expect(
      evaluateAccountSlot({
        maxAccounts: 2,
        activeAccountCount: 2,
        existingStatus: "disconnected",
      })
    ).toMatchObject({ ok: false, code: "account_limit_reached" })

    expect(
      evaluateAccountSlot({
        maxAccounts: 2,
        activeAccountCount: 1,
        existingStatus: "disconnected",
      })
    ).toEqual({ ok: true, reason: "new_slot" })
  })

  it("niega la cuenta nueva sin cupo, y el mensaje nombra la acción que lo libera", () => {
    const decision = evaluateAccountSlot({
      maxAccounts: 5,
      activeAccountCount: 5,
      existingStatus: null,
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.message).toContain("5 cuentas conectadas")
    // Nombra desconectar y no «páginas»: desde el cupo unificado el slot lo
    // libera tanto una Página de Facebook como una cuenta de Instagram.
    expect(decision.message).toContain("Desconecta una cuenta")
    expect(decision.message).not.toContain("página")
  })
})
