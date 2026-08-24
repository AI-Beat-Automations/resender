import { describe, expect, it } from "vitest"

import { decideWhatsappSubmission } from "./signup-submission"

const assets = { wabaId: "10", phoneNumberId: "20", businessId: null }

describe("decideWhatsappSubmission", () => {
  it("envía cuando están los tres", () => {
    expect(
      decideWhatsappSubmission({
        code: "AQD",
        assets,
        nonce: "n1",
        mode: "standard",
      })
    ).toEqual({
      kind: "submit",
      code: "AQD",
      assets,
      nonce: "n1",
      mode: "standard",
    })
  })

  it("espera al otro canal del popup sin arrancar el reloj si no llegó ninguno", () => {
    expect(
      decideWhatsappSubmission({
        code: null,
        assets: null,
        nonce: "n1",
        mode: "standard",
      })
    ).toEqual({ kind: "await-pairing", started: false })
  })

  it("arranca el reloj en cuanto llega uno de los dos", () => {
    // A partir de acá, el silencio del otro canal significa que la autorización
    // volvió a medias y hay que decirlo en vez de dejar el botón girando.
    expect(
      decideWhatsappSubmission({
        code: "AQD",
        assets: null,
        nonce: "n1",
        mode: "standard",
      })
    ).toEqual({ kind: "await-pairing", started: true })

    expect(
      decideWhatsappSubmission({
        code: null,
        assets,
        nonce: "n1",
        mode: "coexistence",
      })
    ).toEqual({ kind: "await-pairing", started: true })
  })

  it("no envía sin nonce, aunque la pareja esté completa", () => {
    // Enviar acá es un `state_mismatch` garantizado con el `code` ya gastado:
    // la cookie está en pleno reemplazo.
    expect(
      decideWhatsappSubmission({
        code: "AQD",
        assets,
        nonce: null,
        mode: "coexistence",
      })
    ).toEqual({ kind: "await-nonce" })
  })

  it("la falta del nonce no se confunde con la falta de la pareja", () => {
    expect(
      decideWhatsappSubmission({
        code: null,
        assets: null,
        nonce: null,
        mode: "standard",
      }).kind
    ).toBe("await-pairing")
  })

  it("lleva el modo hasta el envío: el servidor no puede deducirlo del code", () => {
    const decision = decideWhatsappSubmission({
      code: "AQD",
      assets: { ...assets, phoneNumberId: null },
      nonce: "n1",
      mode: "coexistence",
    })

    expect(decision).toMatchObject({ kind: "submit", mode: "coexistence" })
  })
})
