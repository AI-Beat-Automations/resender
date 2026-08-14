import { describe, expect, it } from "vitest"

import { decideWhatsappSubmission } from "./signup-submission"

const assets = {
  wabaId: "102030405060708",
  phoneNumberId: "109876543210987",
  businessId: null,
}

describe("cuándo se envía el cierre del Embedded Signup", () => {
  it("envía cuando están el code, los identificadores y el nonce", () => {
    expect(
      decideWhatsappSubmission({ code: "AQD-code", assets, nonce: "n0nce" })
    ).toEqual({ kind: "submit", code: "AQD-code", assets, nonce: "n0nce" })
  })

  // Los dos canales del popup se disparan en la misma finalización y sin orden
  // garantizado: con uno solo no hay nada que enviar, pero sí hay que arrancar
  // el reloj de la espera.
  it("espera al otro canal y marca desde cuándo cuenta el reloj", () => {
    expect(
      decideWhatsappSubmission({ code: null, assets: null, nonce: "n0nce" })
    ).toEqual({ kind: "await-pairing", started: false })

    expect(
      decideWhatsappSubmission({ code: "AQD-code", assets: null, nonce: "n0nce" })
    ).toEqual({ kind: "await-pairing", started: true })

    expect(
      decideWhatsappSubmission({ code: null, assets, nonce: "n0nce" })
    ).toEqual({ kind: "await-pairing", started: true })
  })

  // **La ventana que este módulo cierra.** El launcher renueva el nonce cada
  // ocho minutos y también después de cada intento, y durante la renovación
  // retira el que tiene en memoria a propósito. Si la pareja se completa justo
  // ahí, el formulario salía con `nonce: ""` y el servidor lo rechazaba con un
  // `state_mismatch` — con el `code` de 30 segundos ya gastado y el usuario
  // habiendo hecho el onboarding entero. Esperar cuesta lo que tarda una server
  // action; enviar vacío cuesta el flujo completo.
  it("espera al nonce en vez de enviar el formulario con uno vacío", () => {
    expect(
      decideWhatsappSubmission({ code: "AQD-code", assets, nonce: null })
    ).toEqual({ kind: "await-nonce" })
  })

  // Un nonce vacío es lo mismo que no tenerlo: el servidor lo compara en tiempo
  // constante contra `${tenantId}.${nonce}` y nunca coincide.
  it("trata la cadena vacía como ausencia de nonce", () => {
    expect(
      decideWhatsappSubmission({ code: "AQD-code", assets, nonce: "" })
    ).toEqual({ kind: "await-nonce" })
  })
})
