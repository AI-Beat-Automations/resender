import { describe, expect, it } from "vitest"

import {
  DELIVERY_STATUSES,
  outranks,
  overwritableBy,
  type DeliveryStatus,
} from "./delivery-status"

// La matriz completa de los 36 pares ordenados, escrita a mano. Es la única
// forma de que un cambio de la regla se note: una tabla generada con la misma
// función que prueba no prueba nada.
//
// Filas = `prev` (lo que ya está en la fila), columnas = `next` (el callback que
// llega). `true` significa «el UPDATE escribe».
const MATRIX: Record<DeliveryStatus, Record<DeliveryStatus, boolean>> = {
  //        next:  accepted  sent   delivered  read   failed  deleted
  accepted: {
    accepted: false,
    sent: true,
    delivered: true,
    read: true,
    failed: true,
    deleted: true,
  },
  sent: {
    accepted: false,
    sent: false,
    delivered: true,
    read: true,
    failed: true,
    deleted: true,
  },
  delivered: {
    accepted: false,
    sent: false,
    delivered: false,
    read: true,
    failed: false,
    deleted: true,
  },
  read: {
    accepted: false,
    sent: false,
    delivered: false,
    read: false,
    failed: false,
    deleted: true,
  },
  failed: {
    accepted: false,
    sent: false,
    delivered: false,
    read: false,
    failed: true,
    deleted: true,
  },
  deleted: {
    accepted: false,
    sent: false,
    delivered: false,
    read: false,
    failed: false,
    deleted: true,
  },
}

describe("outranks over every ordered pair", () => {
  for (const prev of DELIVERY_STATUSES) {
    for (const next of DELIVERY_STATUSES) {
      const expected = MATRIX[prev][next]
      it(`${expected ? "accepts" : "rejects"} ${next} after ${prev}`, () => {
        expect(outranks(next, prev)).toBe(expected)
      })
    }
  }
})

describe("a message with no callback yet", () => {
  // `null` es la fila recién insertada: el primer callback que llegue manda,
  // incluso si es uno terminal.
  it("accepts any status over null", () => {
    for (const next of DELIVERY_STATUSES) {
      expect(outranks(next, null)).toBe(true)
    }
  })
})

describe("the cases the PRD names", () => {
  // El caso que motiva el módulo entero: el callback de error atrasado sobre un
  // mensaje que el cliente ya leyó. `failed` no es el paso después de `read`,
  // es la otra rama terminal.
  it("rejects failed after read", () => {
    expect(outranks("failed", "read")).toBe(false)
  })

  it("rejects failed after delivered, for the same reason", () => {
    expect(outranks("failed", "delivered")).toBe(false)
  })

  // Lo que sí puede fallar es lo que todavía no llegó.
  it("accepts failed after accepted and after sent", () => {
    expect(outranks("failed", "accepted")).toBe(true)
    expect(outranks("failed", "sent")).toBe(true)
  })

  // «Eliminar para todos» es un hecho, no una etapa: gana contra cualquier
  // estado previo, terminales incluidos.
  it("accepts deleted after everything", () => {
    for (const prev of DELIVERY_STATUSES) {
      expect(outranks("deleted", prev)).toBe(true)
    }
  })

  // El callback duplicado no debe tocar filas: `>` es estricto, así que el
  // empate de la escala se rechaza y el UPDATE reporta 0.
  it("rejects an equal-rank repeat", () => {
    expect(outranks("accepted", "accepted")).toBe(false)
    expect(outranks("sent", "sent")).toBe(false)
    expect(outranks("delivered", "delivered")).toBe(false)
    expect(outranks("read", "read")).toBe(false)
  })

  // Nadie sale de `failed`: un `delivered` posterior es un callback viejo de
  // otro intento, no una entrega nueva.
  it("keeps failed terminal against the whole scale", () => {
    expect(outranks("accepted", "failed")).toBe(false)
    expect(outranks("sent", "failed")).toBe(false)
    expect(outranks("delivered", "failed")).toBe(false)
    expect(outranks("read", "failed")).toBe(false)
  })

  // El callback atrasado clásico: `sent` llegando después de `read`.
  it("never walks a message backwards down the scale", () => {
    expect(outranks("sent", "read")).toBe(false)
    expect(outranks("delivered", "read")).toBe(false)
    expect(outranks("accepted", "sent")).toBe(false)
  })
})

// El punto del módulo: la lista que viaja al `= any(...)` del UPDATE y la
// función de TypeScript tienen que decir exactamente lo mismo. Si divergen, el
// predicado de Postgres deja pasar (o bloquea) lo que la regla no dice.
describe("the SQL allow-list agrees with outranks", () => {
  for (const next of DELIVERY_STATUSES) {
    it(`lists exactly what ${next} may overwrite`, () => {
      const allowed = overwritableBy(next)
      for (const prev of DELIVERY_STATUSES) {
        expect(allowed.includes(prev)).toBe(outranks(next, prev))
      }
    })
  }

  it("gives accepted an empty list, so it only writes over null", () => {
    // `delivery_status = any('{}')` es falso para toda fila; el `is null` del
    // predicado es lo único que puede dejar pasar a `accepted`.
    expect(overwritableBy("accepted")).toEqual([])
  })

  it("gives deleted the whole catalogue", () => {
    expect([...overwritableBy("deleted")].sort()).toEqual(
      [...DELIVERY_STATUSES].sort()
    )
  })

  it("keeps delivered and read out of the failed list", () => {
    expect(overwritableBy("failed")).not.toContain("delivered")
    expect(overwritableBy("failed")).not.toContain("read")
    expect(overwritableBy("failed")).not.toContain("deleted")
  })

  it("never lets a status overwrite itself down the scale", () => {
    expect(overwritableBy("sent")).not.toContain("sent")
    expect(overwritableBy("delivered")).not.toContain("delivered")
    expect(overwritableBy("read")).not.toContain("read")
  })
})

describe("the catalogue", () => {
  // El mismo check `delivery_status in (...)` de la migración 0017: si alguien
  // agrega un séptimo estado allá, este test es el que lo recuerda acá.
  it("matches the check constraint of migration 0017", () => {
    expect(DELIVERY_STATUSES).toEqual([
      "accepted",
      "sent",
      "delivered",
      "read",
      "failed",
      "deleted",
    ])
  })
})
