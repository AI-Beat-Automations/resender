import { describe, expect, it } from "vitest"

import {
  formatMetaConnectionError,
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
      "unknown",
    ]

    for (const reason of reasons) {
      expect(formatMetaConnectionError(reason)).toMatch(
        /^No se pudo conectar: /
      )
    }
  })
})
