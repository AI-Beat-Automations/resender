import { describe, expect, it } from "vitest"

import {
  decideWhatsappTemplateSend,
  type MirroredTemplate,
} from "./template-gate"
import type { WhatsappTemplateStatus } from "./template-registry"

function mirrored(
  status: WhatsappTemplateStatus,
  // El crudo por separado y como `string`: es justamente lo que no pasa por el
  // catálogo, y con `unknown` es el único dato que queda del estado real.
  rawStatus: string = status
): MirroredTemplate {
  return { name: "order_update", language: "es", status, rawStatus }
}

// Los estados del catálogo que **no** son `APPROVED`, escritos a mano y no
// importados del registro: si alguien agrega un estado allá y se olvida de
// decidir qué pasa con él, lo que tiene que fallar es la compilación del gate y
// no este test, que debe seguir afirmando lo que afirma hoy.
const NOT_APPROVED = [
  "PENDING",
  "IN_REVIEW",
  "IN_APPEAL",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "PENDING_DELETION",
  "LIMIT_EXCEEDED",
] as const satisfies readonly WhatsappTemplateStatus[]

describe("gate del espejo de plantillas", () => {
  it("permite enviar una plantilla aprobada", () => {
    expect(decideWhatsappTemplateSend(mirrored("APPROVED"))).toEqual({
      allowed: true,
    })
  })

  it("rechaza cualquier estado que no sea APPROVED, nombrándolo", () => {
    for (const status of NOT_APPROVED) {
      const decision = decideWhatsappTemplateSend(mirrored(status))

      expect(decision.allowed).toBe(false)
      if (decision.allowed) throw new Error("unreachable")
      expect(decision.status).toBe(status)
      // El estado tiene que estar en el texto y no sólo en el campo: es lo que
      // el integrador ve en su log sin parsear el cuerpo.
      expect(decision.message).toContain(status)
      // Y algo que hacer con él, que es el punto de nombrarlo.
      expect(decision.message.length).toBeGreaterThan(status.length + 40)
    }
  })

  // Un estado que Meta agregue mañana llega como `unknown`, y `unknown` no es
  // «probablemente esté bien»: no sabemos que esté aprobada, así que no se
  // envía. Es la única rama donde el espejo tiene la fila y aun así no
  // entendemos qué dice.
  it("rechaza un estado que no reconoce, conservando el que mandó Meta", () => {
    const decision = decideWhatsappTemplateSend(
      mirrored("unknown", "SOMETHING_META_INVENTED")
    )

    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error("unreachable")
    expect(decision.status).toBe("unknown")
    expect(decision.rawStatus).toBe("SOMETHING_META_INVENTED")
    expect(decision.message).toContain("SOMETHING_META_INVENTED")
  })

  // **El caso que codifica el fail-open, y el que más fácil se rompe en una
  // refactorización futura.** Que el espejo no conozca la plantilla NO es
  // motivo para rechazar: es lo que pasa con una plantilla creada en WhatsApp
  // Manager después del último sync, y el cliente no tiene forma de arreglarlo
  // de su lado. Se envía y decide Meta, que es la autoridad.
  it("PERMITE el envío cuando la plantilla NO está en el espejo (fail-open deliberado)", () => {
    expect(decideWhatsappTemplateSend(null)).toEqual({ allowed: true })
  })

  it("no confunde la fila ausente con una fila en estado desconocido", () => {
    // La ausencia permite; `unknown` rechaza. Son dos hechos distintos y el
    // gate no puede aplanarlos: uno es «no sabemos nada de esta plantilla», el
    // otro es «Meta dijo algo y ese algo no es aprobada».
    expect(decideWhatsappTemplateSend(null).allowed).toBe(true)
    expect(decideWhatsappTemplateSend(mirrored("unknown")).allowed).toBe(false)
  })
})
