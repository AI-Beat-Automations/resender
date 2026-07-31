import { describe, expect, it } from "vitest"

import { formatMetaConnectionError } from "./meta-connection-error"

describe("formatMetaConnectionError", () => {
  it("explains that no page was saved when the webhook subscription failed", () => {
    expect(formatMetaConnectionError("webhook_subscription_failed")).toBe(
      "No se pudo conectar: Meta no confirmó la suscripción al webhook de todas las páginas. Ninguna página quedó guardada."
    )
  })

  it("does not expose the Page id owned by another tenant", () => {
    expect(formatMetaConnectionError("page_owned:104233889761204")).toBe(
      "No se pudo conectar: una página seleccionada ya pertenece a otra cuenta de Resender."
    )
    expect(
      formatMetaConnectionError("page_owned:104233889761204")
    ).not.toContain("104233889761204")
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

  it("does not reflect an unknown reason", () => {
    expect(formatMetaConnectionError("something_odd")).toBe(
      "No se pudo conectar."
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
    ]

    for (const reason of reasons) {
      expect(formatMetaConnectionError(reason)).toMatch(
        /^No se pudo conectar: /
      )
    }
  })
})
