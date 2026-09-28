import { describe, expect, it } from "vitest"

import { decideTemplateSend } from "./send-gate"

describe("decideTemplateSend", () => {
  // La decisión que sostiene todo el control: un hueco en la copia es un
  // estado válido —una plantilla recién creada en WhatsApp Manager— y NO se
  // rechaza. Decide Meta.
  it("fila ausente → permite el envío", () => {
    expect(decideTemplateSend(null)).toEqual({ ok: true })
  })

  it("APPROVED → permite el envío", () => {
    expect(decideTemplateSend({ status: "APPROVED" })).toEqual({ ok: true })
  })

  it("PENDING → rechaza nombrando el estado", () => {
    expect(decideTemplateSend({ status: "PENDING" })).toEqual({
      ok: false,
      status: "PENDING",
    })
  })

  it.each(["REJECTED", "PAUSED", "DISABLED", "ARCHIVED"] as const)(
    "%s → rechaza",
    (status) => {
      expect(decideTemplateSend({ status })).toEqual({ ok: false, status })
    }
  )

  // Un estado que Meta mandó y no reconocemos no es falta de dato: la
  // plantilla existe y no está aprobada.
  it("unknown → rechaza", () => {
    expect(decideTemplateSend({ status: "unknown" })).toEqual({
      ok: false,
      status: "unknown",
    })
  })
})
