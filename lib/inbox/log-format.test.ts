import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"

import { en } from "@/content/i18n/app/en"

import {
  formatDayLabel,
  formatLogTimestamp,
  formatMessageMeta,
  formatRelativeTime,
} from "./log-format"

const NOW = new Date(2026, 6, 27, 15, 30)

describe("formatLogTimestamp", () => {
  it("usa hoy y ayer para los dos días más recientes", () => {
    expect(formatLogTimestamp(new Date(2026, 6, 27, 14, 2), NOW, es)).toBe(
      "hoy 14:02"
    )
    expect(formatLogTimestamp(new Date(2026, 6, 26, 19, 12), NOW, es)).toBe(
      "ayer 19:12"
    )
  })

  it("usa fecha corta fuera de hoy y ayer, con año solo si no es el actual", () => {
    expect(formatLogTimestamp(new Date(2026, 6, 24, 9, 5), NOW, es)).toBe(
      "24 jul"
    )
    expect(formatLogTimestamp(new Date(2025, 6, 24, 9, 5), NOW, es)).toBe(
      "24 jul 2025"
    )
  })
})

describe("formatDayLabel", () => {
  it("siempre lleva año: el separador del hilo se lee sin contexto", () => {
    expect(formatDayLabel(new Date(2026, 6, 27, 14, 2), es)).toBe("27 jul 2026")
  })
})

describe("formatMessageMeta", () => {
  it("traduce la dirección y pone la hora sin segundos", () => {
    expect(
      formatMessageMeta(
        {
          direction: "outbound",
          createdAt: new Date(2026, 6, 27, 14, 2, 11),
        },
        es
      )
    ).toBe("respuesta · 14:02")
    expect(
      formatMessageMeta(
        {
          direction: "inbound",
          createdAt: new Date(2026, 6, 27, 14, 1, 59),
        },
        es
      )
    ).toBe("entrante · 14:01")
  })
})

describe("formatRelativeTime", () => {
  const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000)

  it("elige la unidad más gruesa que cabe", () => {
    expect(formatRelativeTime(minutes(0), NOW, es)).toBe("ahora")
    expect(formatRelativeTime(minutes(5), NOW, es)).toBe("hace 5 minutos")
    expect(formatRelativeTime(minutes(120), NOW, es)).toBe("hace 2 horas")
    expect(formatRelativeTime(minutes(60 * 24), NOW, es)).toBe("ayer")
    expect(formatRelativeTime(minutes(60 * 24 * 3), NOW, es)).toBe(
      "hace 3 días"
    )
    expect(formatRelativeTime(minutes(60 * 24 * 60), NOW, es)).toBe(
      "hace 2 meses"
    )
  })

  it("sale en el idioma del diccionario", () => {
    expect(formatRelativeTime(minutes(120), NOW, en)).toBe("2 hours ago")
  })

  // Un reloj desfasado no puede decir «dentro de 3 minutos» sobre una pausa.
  it("un instante futuro se lee como ahora", () => {
    expect(formatRelativeTime(minutes(-3), NOW, es)).toBe("ahora")
  })
})
