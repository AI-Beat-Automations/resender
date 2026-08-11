import crypto from "crypto"

import { describe, expect, it } from "vitest"

import { verifyMetaSignature } from "./webhook-signature"

const APP_SECRET = "instagram-app-secret"
const OTHER_SECRET = "facebook-app-secret"

function sign(raw: string, secret: string) {
  return (
    "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")
  )
}

describe("verifyMetaSignature", () => {
  const raw = JSON.stringify({ object: "instagram", entry: [{ id: "1" }] })

  it("acepta una firma correcta", () => {
    expect(
      verifyMetaSignature({
        raw,
        header: sign(raw, APP_SECRET),
        appSecret: APP_SECRET,
      })
    ).toEqual({ ok: true })
  })

  it("distingue la falta de firma del desajuste", () => {
    // Son dos investigaciones distintas: sin firma es Meta pegándole a la ruta
    // equivocada o alguien que no es Meta; desajustada es el App Secret mal
    // cargado. Colapsarlas en un solo motivo es lo que hacía la ruta original.
    expect(
      verifyMetaSignature({ raw, header: null, appSecret: APP_SECRET })
    ).toEqual({ ok: false, reason: "missing_signature" })

    expect(
      verifyMetaSignature({ raw, header: "", appSecret: APP_SECRET })
    ).toEqual({ ok: false, reason: "missing_signature" })
  })

  it("rechaza una firma hecha con el secreto del otro canal", () => {
    // El incidente de la etapa 9: pegar las credenciales de Facebook en las
    // variables de Instagram deja la ruta rechazando todo.
    expect(
      verifyMetaSignature({
        raw,
        header: sign(raw, OTHER_SECRET),
        appSecret: APP_SECRET,
      })
    ).toEqual({ ok: false, reason: "signature_mismatch" })
  })

  it("rechaza una firma de otro largo sin tirar", () => {
    // `timingSafeEqual` lanza si los largos difieren; el chequeo previo es lo
    // que evita que un header basura tumbe la ruta con un 500.
    expect(
      verifyMetaSignature({ raw, header: "sha256=corta", appSecret: APP_SECRET })
    ).toEqual({ ok: false, reason: "signature_mismatch" })
  })

  it("rechaza el body reserializado", () => {
    // La firma es sobre el texto **crudo**: cambiar el espaciado la invalida.
    const header = sign(raw, APP_SECRET)
    const reserialized = JSON.stringify(JSON.parse(raw), null, 2)

    expect(
      verifyMetaSignature({
        raw: reserialized,
        header,
        appSecret: APP_SECRET,
      })
    ).toEqual({ ok: false, reason: "signature_mismatch" })
  })
})
