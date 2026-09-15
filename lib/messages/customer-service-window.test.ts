import { describe, expect, it } from "vitest"

import {
  CUSTOMER_SERVICE_WINDOW_HOURS,
  isWindowOpen,
} from "./customer-service-window"

const lastInbound = new Date("2026-08-24T10:00:00.000Z")
const after = (ms: number) => new Date(lastInbound.getTime() + ms)

const SECOND = 1000
const HOUR = 60 * 60 * SECOND

describe("customer service window", () => {
  it("declares the window as 24 hours", () => {
    expect(CUSTOMER_SERVICE_WINDOW_HOURS).toBe(24)
  })

  // Sin entrante no hay ventana que abrir: es el primer contacto, donde el
  // negocio quiere escribir primero y sólo puede con plantilla.
  it("treats a conversation with no inbound as closed", () => {
    expect(isWindowOpen(null, after(0))).toBe(false)
  })

  it("is open right after the inbound arrives", () => {
    expect(isWindowOpen(lastInbound, after(0))).toBe(true)
    expect(isWindowOpen(lastInbound, after(SECOND))).toBe(true)
  })

  // El borde exacto, que es lo único que este módulo tiene que acertar.
  it("is open at 23:59:59", () => {
    expect(isWindowOpen(lastInbound, after(24 * HOUR - SECOND))).toBe(true)
  })

  // Exclusivo: a las 24:00:00 clavadas ya está cerrada. Con el borde inclusivo
  // mandaríamos justo el mensaje que Cloud API rechaza en el segundo del corte.
  it("is closed at exactly 24:00:00", () => {
    expect(isWindowOpen(lastInbound, after(24 * HOUR))).toBe(false)
  })

  it("is closed at 24:00:01", () => {
    expect(isWindowOpen(lastInbound, after(24 * HOUR + SECOND))).toBe(false)
  })

  it("stays closed long after the window elapsed", () => {
    expect(isWindowOpen(lastInbound, after(180 * 24 * HOUR))).toBe(false)
  })

  // Desfase de reloj: un entrante fechado en el futuro cuenta como abierta.
  // Meta es la autoridad final y rechazará si corresponde; negar el envío por
  // unos milisegundos de deriva sería peor.
  it("treats clock skew into the future as open", () => {
    expect(isWindowOpen(lastInbound, after(-SECOND))).toBe(true)
  })

  it("does not depend on the process clock", () => {
    // El mismo par de fechas da el mismo resultado sin importar cuándo corra el
    // test: `now` es un parámetro, no `Date.now()`.
    expect(
      isWindowOpen(
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2020-01-01T23:59:59.999Z")
      )
    ).toBe(true)
    expect(
      isWindowOpen(
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2020-01-02T00:00:00.000Z")
      )
    ).toBe(false)
  })
})
