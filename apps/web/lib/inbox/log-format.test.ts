import { describe, expect, it } from "vitest"

import { formatDayLabel, formatLogTimestamp, formatMessageMeta } from "./log-format"

const NOW = new Date(2026, 6, 27, 15, 30)

describe("formatLogTimestamp", () => {
  it("usa hoy y ayer para los dos días más recientes", () => {
    expect(formatLogTimestamp(new Date(2026, 6, 27, 14, 2), NOW)).toBe(
      "hoy 14:02"
    )
    expect(formatLogTimestamp(new Date(2026, 6, 26, 19, 12), NOW)).toBe(
      "ayer 19:12"
    )
  })

  it("usa fecha corta fuera de hoy y ayer, con año solo si no es el actual", () => {
    expect(formatLogTimestamp(new Date(2026, 6, 24, 9, 5), NOW)).toBe("24 jul")
    expect(formatLogTimestamp(new Date(2025, 6, 24, 9, 5), NOW)).toBe(
      "24 jul 2025"
    )
  })
})

describe("formatDayLabel", () => {
  it("siempre lleva año: el separador del hilo se lee sin contexto", () => {
    expect(formatDayLabel(new Date(2026, 6, 27, 14, 2))).toBe("27 jul 2026")
  })
})

describe("formatMessageMeta", () => {
  it("compone dirección, hora con segundos y estado", () => {
    expect(
      formatMessageMeta({
        direction: "outbound",
        status: "sent",
        createdAt: new Date(2026, 6, 27, 14, 2, 11),
      })
    ).toBe("outbound · 14:02:11 · sent")
  })
})
