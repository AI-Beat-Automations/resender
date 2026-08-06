import { describe, expect, it } from "vitest"

import {
  formatMetaConnectionError,
  instagramAccountOwnedReason,
  metaPageOwnedReason,
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

  // Los dos prefijos de propiedad conviven: el de Instagram no puede caer en la
  // rama de `page_owned:` ni al revés, o el mensaje nombraría el canal
  // equivocado.
  it("keeps the two ownership prefixes apart", () => {
    expect(formatMetaConnectionError(metaPageOwnedReason("999"))).toContain(
      "la página 999"
    )
    expect(
      formatMetaConnectionError(instagramAccountOwnedReason("999"))
    ).toContain("la cuenta de Instagram 999")
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
      "unknown",
    ]

    for (const reason of reasons) {
      expect(formatMetaConnectionError(reason)).toMatch(
        /^No se pudo conectar: /
      )
    }
  })
})
