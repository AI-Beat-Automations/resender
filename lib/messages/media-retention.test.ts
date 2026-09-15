import { describe, expect, it } from "vitest"

import {
  ATTACHMENT_STATUSES,
  MEDIA_RETENTION_DAYS,
  ageInDays,
  effectiveStatus,
  type AttachmentStatus,
} from "./media-retention"

const NOW = new Date("2026-08-24T12:00:00.000Z")
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Una fila creada hace `days` días (más un desfase opcional en ms). */
function createdDaysAgo(days: number, offsetMs = 0): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY + offsetMs)
}

function row(
  attachment_status: AttachmentStatus,
  created_at: Date
): { attachment_status: AttachmentStatus; created_at: Date } {
  return { attachment_status, created_at }
}

describe("the retention window", () => {
  // El mismo número que la lifecycle rule del bucket. Si este test falla, R2 y
  // la UI dejaron de contar lo mismo.
  it("is 180 days", () => {
    expect(MEDIA_RETENTION_DAYS).toBe(180)
  })
})

describe("the 180-day boundary", () => {
  it("keeps a brand new attachment available", () => {
    expect(effectiveStatus(row("available", NOW), NOW)).toBe("available")
  })

  it("keeps day 179 available", () => {
    expect(effectiveStatus(row("available", createdDaysAgo(179)), NOW)).toBe(
      "available"
    )
  })

  // El borde exacto: el día 180 es el último día de retención, no el primero
  // vencido. El corte es `>`, no `>=`.
  it("keeps day 180 available, exactly on the edge", () => {
    expect(effectiveStatus(row("available", createdDaysAgo(180)), NOW)).toBe(
      "available"
    )
  })

  // Y el día entero: a los 180 días y 23 horas todavía es día 180 para R2, que
  // también cuenta en días enteros.
  it("keeps the whole of day 180 available", () => {
    const almostDay181 = createdDaysAgo(180, -(MS_PER_DAY - 1))
    expect(effectiveStatus(row("available", almostDay181), NOW)).toBe(
      "available"
    )
  })

  it("reports day 181 as deleted", () => {
    expect(effectiveStatus(row("available", createdDaysAgo(181)), NOW)).toBe(
      "deleted"
    )
  })

  it("reports anything older than day 181 as deleted", () => {
    expect(effectiveStatus(row("available", createdDaysAgo(365)), NOW)).toBe(
      "deleted"
    )
  })
})

describe("statuses other than available", () => {
  const others = ATTACHMENT_STATUSES.filter((s) => s !== "available")

  // Ninguno de los otros cuatro vence: solo `available` puede dejar de serlo.
  it("passes them through untouched no matter the age", () => {
    for (const status of others) {
      for (const days of [0, 179, 180, 181, 365, 5000]) {
        expect(effectiveStatus(row(status, createdDaysAgo(days)), NOW)).toBe(
          status
        )
      }
    }
  })

  // El caso que más importa de los cuatro: un `failed` viejo no se convierte en
  // `deleted`. «No se pudo descargar» y «lo tuvimos y venció» son cosas
  // distintas, y confundirlas le cuenta al cliente que tuvimos un archivo que
  // nunca tuvimos.
  it("never turns an old failed into deleted", () => {
    expect(effectiveStatus(row("failed", createdDaysAgo(400)), NOW)).toBe(
      "failed"
    )
  })

  // Ídem `unavailable`: Meta nunca lo ofreció (historial de más de 14 días), no
  // hubo nada en R2 que pudiera vencer.
  it("never turns an old unavailable into deleted", () => {
    expect(effectiveStatus(row("unavailable", createdDaysAgo(400)), NOW)).toBe(
      "unavailable"
    )
  })

  // Un `pending` viejo es una descarga que se colgó: sigue siendo `pending`
  // para que la cola lo pueda ver, no un adjunto vencido.
  it("keeps an old pending pending", () => {
    expect(effectiveStatus(row("pending", createdDaysAgo(400)), NOW)).toBe(
      "pending"
    )
  })

  // Uno ya marcado `deleted` en DB se queda igual: derivar no lo revive.
  it("leaves a stored deleted alone, even if it is young", () => {
    expect(effectiveStatus(row("deleted", createdDaysAgo(1)), NOW)).toBe(
      "deleted"
    )
  })
})

describe("age in whole days", () => {
  it("counts floored days", () => {
    expect(ageInDays(createdDaysAgo(0), NOW)).toBe(0)
    expect(ageInDays(createdDaysAgo(1, 1), NOW)).toBe(0)
    expect(ageInDays(createdDaysAgo(1), NOW)).toBe(1)
    expect(ageInDays(createdDaysAgo(180), NOW)).toBe(180)
    expect(ageInDays(createdDaysAgo(181), NOW)).toBe(181)
  })

  // Reloj desfasado: una fila «del futuro» tiene edad 0, no negativa. El
  // negativo solo propagaría el error hacia el corte de retención.
  it("clamps a future row to zero", () => {
    expect(ageInDays(new Date(NOW.getTime() + MS_PER_DAY), NOW)).toBe(0)
    expect(
      effectiveStatus(
        row("available", new Date(NOW.getTime() + MS_PER_DAY)),
        NOW
      )
    ).toBe("available")
  })
})

describe("the catalogue", () => {
  // El mismo check `attachment_status in (...)` de la migración 0017: si
  // alguien agrega un sexto estado allá, este test es el que lo recuerda acá.
  it("matches the check constraint of migration 0017", () => {
    expect(ATTACHMENT_STATUSES).toEqual([
      "pending",
      "available",
      "failed",
      "deleted",
      "unavailable",
    ])
  })
})
