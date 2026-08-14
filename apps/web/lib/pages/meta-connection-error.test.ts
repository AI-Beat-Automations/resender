import { describe, expect, it } from "vitest"

import {
  formatMetaConnectionError,
  instagramAccountOwnedReason,
  metaPageOwnedReason,
  whatsappNumberOwnedReason,
} from "./meta-connection-error"

describe("formatMetaConnectionError", () => {
  it("explains that no page was saved when the webhook subscription failed", () => {
    expect(formatMetaConnectionError("webhook_subscription_failed")).toBe(
      "No se pudo conectar: Meta no confirmó la suscripción al webhook de todas las páginas. Ninguna página quedó guardada."
    )
  })

  it("names the page id taken by another tenant", () => {
    expect(formatMetaConnectionError("page_owned:104233889761204")).toBe(
      "No se pudo conectar: la página 104233889761204 ya pertenece a otra cuenta de Resender."
    )
  })

  it("builds the page_owned reason from a page id", () => {
    expect(
      formatMetaConnectionError(metaPageOwnedReason("118456220134987"))
    ).toContain("la página 118456220134987")
  })

  it("reports the server misconfiguration", () => {
    expect(formatMetaConnectionError("configuration_failed")).toBe(
      "No se pudo conectar: el cifrado de secretos del servidor no está configurado."
    )
  })

  it("sends the user back through the Meta dialog when the session expired", () => {
    expect(formatMetaConnectionError("meta_session_expired")).toBe(
      "No se pudo conectar: tu autorización de Meta venció. Vuelve a conectar Facebook."
    )
  })

  it("explains a state mismatch as an expired authorization session", () => {
    expect(formatMetaConnectionError("state_mismatch")).toBe(
      "No se pudo conectar: la sesión de autorización venció o no coincide. Inténtalo de nuevo."
    )
  })

  it("names the failing step of the Instagram connection", () => {
    expect(formatMetaConnectionError("instagram_exchange_failed")).toBe(
      "No se pudo conectar: Instagram no completó el intercambio de credenciales. Vuelve a intentarlo."
    )
    expect(formatMetaConnectionError("instagram_profile_failed")).toContain(
      "no devolvió su perfil"
    )
    expect(
      formatMetaConnectionError("instagram_subscription_failed")
    ).toContain("La cuenta no quedó conectada.")
  })

  it("names the Instagram account taken by another tenant", () => {
    expect(
      formatMetaConnectionError(
        instagramAccountOwnedReason("17841400000000000")
      )
    ).toBe(
      "No se pudo conectar: la cuenta de Instagram 17841400000000000 ya pertenece a otra cuenta de Resender."
    )
  })

  // Un motivo por paso del Embedded Signup: los cinco vuelven a la misma
  // pantalla sin el número, así que el texto es lo único que dice cuál falló y
  // quién tiene que arreglarlo.
  it("names the failing step of the WhatsApp connection", () => {
    expect(formatMetaConnectionError("whatsapp_exchange_failed")).toBe(
      "No se pudo conectar: Meta no completó el intercambio de credenciales de WhatsApp. Vuelve a intentarlo."
    )
    expect(formatMetaConnectionError("whatsapp_assets_failed")).toContain(
      "no incluyó el número ni la cuenta de WhatsApp Business"
    )
    expect(formatMetaConnectionError("whatsapp_register_failed")).toContain(
      "no pudo registrar el número en Cloud API"
    )
    expect(formatMetaConnectionError("whatsapp_subscribe_failed")).toContain(
      "El número no quedó conectado."
    )
    expect(formatMetaConnectionError("whatsapp_persist_failed")).toContain(
      "se autorizó en Meta pero no se pudo guardar"
    )
  })

  // WhatsApp no comparte el `state_mismatch` genérico: su causa número uno no
  // es un vencimiento sino una segunda pestaña de Conexiones que pisó el nonce
  // (la cookie es una sola por navegador). Y llega en el peor momento posible —
  // con el WABA creado, el número verificado por SMS y el `code` ya gastado—,
  // así que el texto tiene que nombrar la causa y el remedio, no dejar al
  // usuario reintentando lo mismo.
  it("blames the second tab for a WhatsApp nonce mismatch, instead of a vague expiry", () => {
    const message = formatMetaConnectionError("whatsapp_state_mismatch")

    expect(message).toContain("otra pestaña")
    expect(message).toContain("desde una sola")
    // Y no reusa el texto compartido, que solo dice «venció».
    expect(message).not.toBe(formatMetaConnectionError("state_mismatch"))
  })

  it("names the WhatsApp number taken by another tenant", () => {
    expect(
      formatMetaConnectionError(whatsappNumberOwnedReason("109876543210987"))
    ).toBe(
      "No se pudo conectar: el número de WhatsApp 109876543210987 ya pertenece a otra cuenta de Resender."
    )
  })

  // Los tres prefijos de propiedad conviven: ninguno puede caer en la rama de
  // otro, o el mensaje nombraría el canal equivocado y mandaría al usuario a
  // buscar una página de Facebook que nunca conectó.
  it("keeps the three ownership prefixes apart", () => {
    expect(formatMetaConnectionError(metaPageOwnedReason("999"))).toContain(
      "la página 999"
    )
    expect(
      formatMetaConnectionError(instagramAccountOwnedReason("999"))
    ).toContain("la cuenta de Instagram 999")
    expect(
      formatMetaConnectionError(whatsappNumberOwnedReason("999"))
    ).toContain("el número de WhatsApp 999")
  })

  it("falls back to the raw reason and to the bare message without one", () => {
    expect(formatMetaConnectionError("something_odd")).toBe(
      "No se pudo conectar: something_odd."
    )
    expect(formatMetaConnectionError()).toBe("No se pudo conectar.")
    expect(formatMetaConnectionError(null)).toBe("No se pudo conectar.")
    expect(formatMetaConnectionError("")).toBe("No se pudo conectar.")
  })

  it("always starts with the connection error prefix", () => {
    const reasons = [
      "webhook_subscription_failed",
      "page_owned:1",
      "configuration_failed",
      "meta_session_expired",
      "state_mismatch",
      "instagram_exchange_failed",
      "instagram_profile_failed",
      "instagram_subscription_failed",
      "instagram_account_owned:1",
      "whatsapp_exchange_failed",
      "whatsapp_assets_failed",
      "whatsapp_register_failed",
      "whatsapp_subscribe_failed",
      "whatsapp_persist_failed",
      "whatsapp_state_mismatch",
      "whatsapp_number_owned:1",
      "unknown",
    ]

    for (const reason of reasons) {
      expect(formatMetaConnectionError(reason)).toMatch(
        /^No se pudo conectar: /
      )
    }
  })
})
