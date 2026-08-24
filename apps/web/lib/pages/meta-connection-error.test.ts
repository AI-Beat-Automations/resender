import { describe, expect, it } from "vitest"

import {
  formatMetaConnectionError,
  instagramAccountOwnedReason,
  metaPageOwnedReason,
  whatsappNumberOwnedReason,
  whatsappStepFailedReason,
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

  // El gate de canal (ADR 0010) rebota por la misma vía que los fallos de Meta,
  // así que necesita su propia redacción: sin ella la pantalla mostraría
  // `instagram_not_enabled` crudo, que no le dice nada al que lo lee.
  it("explains that the Instagram channel is not enabled for the account", () => {
    expect(formatMetaConnectionError("instagram_not_enabled")).toBe(
      "No se pudo conectar: el canal de Instagram no está habilitado para tu cuenta."
    )
  })

  // El rebote por cupo del callback (ADR 0011). Habla de conexiones porque el
  // slot ocupado puede ser una Página de Facebook y no una cuenta de Instagram.
  it("explains that the plan has no free connection slot left", () => {
    expect(formatMetaConnectionError("instagram_page_limit_reached")).toBe(
      "No se pudo conectar: el cupo de conexiones de tu plan está completo. Desconecta una conexión en Conexiones para liberar cupo."
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
      "instagram_exchange_failed",
      "instagram_profile_failed",
      "instagram_subscription_failed",
      "instagram_account_owned:1",
      "instagram_not_enabled",
      "instagram_page_limit_reached",
      "whatsapp_not_enabled",
      "whatsapp_page_limit_reached",
      "whatsapp_exchange_failed",
      "whatsapp_assets_failed",
      "whatsapp_register_failed",
      "whatsapp_subscribe_failed",
      "whatsapp_sync_request_failed",
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

describe("motivos de WhatsApp", () => {
  // Los seis pasos de `WhatsappOnboardingStep`. El test existe para que agregar
  // un paso al cliente sin darle texto acá se note: el motivo saldría crudo.
  const STEPS = [
    "exchange",
    "assets",
    "register",
    "subscribe",
    "sync_request",
    "persist",
  ] as const

  it("da un texto propio a cada paso del Embedded Signup", () => {
    for (const step of STEPS) {
      const message = formatMetaConnectionError(whatsappStepFailedReason(step))
      expect(message).toMatch(/^No se pudo conectar: /)
      // Crudo significa «cayó en el default»: el motivo entero pegado al final.
      expect(message).not.toContain(`whatsapp_${step}_failed`)
    }
  })

  it("no promete que no quedó nada guardado cuando falla el history sync", () => {
    // El único paso que corre con la conexión ya persistida.
    expect(formatMetaConnectionError("whatsapp_sync_request_failed")).toContain(
      "quedó conectado"
    )
  })

  it("nombra el phone_number_id que ya pertenece a otro tenant", () => {
    expect(
      formatMetaConnectionError(whatsappNumberOwnedReason("109988776655"))
    ).toBe(
      "No se pudo conectar: el número de WhatsApp 109988776655 ya pertenece a otra cuenta de Resender."
    )
  })

  it("explica el state_mismatch por la causa real: dos pestañas", () => {
    const message = formatMetaConnectionError("whatsapp_state_mismatch")
    expect(message).toContain("pestaña")
    // No comparte texto con el `state_mismatch` genérico de los otros canales.
    expect(message).not.toBe(formatMetaConnectionError("state_mismatch"))
  })

  it("explica el gate de canal y el cupo sin hablar de Instagram", () => {
    expect(formatMetaConnectionError("whatsapp_not_enabled")).toContain(
      "WhatsApp"
    )
    expect(formatMetaConnectionError("whatsapp_page_limit_reached")).toContain(
      "cupo"
    )
  })
})
