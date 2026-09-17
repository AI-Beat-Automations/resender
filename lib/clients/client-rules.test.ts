import { describe, expect, it } from "vitest"

import {
  canManageClients,
  isOverMax,
  validateMaxConnections,
} from "./client-rules"

// Reglas puras del módulo Clientes (issue #154). Tests de tabla, sin mocks,
// como `lib/billing/entitlements.test.ts`.
describe("canManageClients", () => {
  it.each([
    ["pro_monthly", true],
    ["business_monthly", true],
    ["starter_monthly", false],
    [null, false],
    ["unknown_plan", false],
  ])("plan %s → %s", (plan, expected) => {
    expect(canManageClients(plan)).toBe(expected)
  })
})

describe("validateMaxConnections", () => {
  it("acepta un entero entre 1 y el máximo del plan", () => {
    expect(validateMaxConnections("3", 5)).toEqual({ ok: true, value: 3 })
    expect(validateMaxConnections(1, 5)).toEqual({ ok: true, value: 1 })
    expect(validateMaxConnections("5", 5)).toEqual({ ok: true, value: 5 })
  })

  it.each([
    ["0", 5],
    ["-1", 5],
    ["6", 5],
    ["2.5", 5],
    ["abc", 5],
    ["", 5],
    [null, 5],
    [undefined, 5],
  ])("rechaza %s con máximo %s", (input, maxPages) => {
    expect(validateMaxConnections(input, maxPages)).toEqual({
      ok: false,
      error: "max_out_of_range",
    })
  })
})

describe("isOverMax", () => {
  // La celda `conectadas / tope` se pinta en rojo solo cuando lo conectado
  // supera el tope: igualar el tope es «lleno», no un problema.
  it("es true solo cuando lo conectado supera el tope", () => {
    expect(isOverMax(3, 2)).toBe(true)
    expect(isOverMax(2, 2)).toBe(false)
    expect(isOverMax(0, 1)).toBe(false)
  })
})
