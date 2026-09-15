import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"
import { en } from "@/content/i18n/app/en"

import {
  formatMetaConnectionError as formatWithDict,
  instagramAccountOwnedReason,
  metaPageOwnedReason,
  whatsappNumberOwnedReason,
  whatsappStepFailedReason,
} from "./meta-connection-error"

// El catálogo se prueba en español, que es donde está escrito el criterio de
// cada mensaje. La paridad con el inglés la garantiza el tipo `AppDict`; lo que
// no puede garantizar —que el `reason` caiga en la clave correcta— es lo que
// prueban estos casos, y eso no depende del idioma.
const format = (reason?: string | null) => formatWithDict(reason, es)

describe("formatMetaConnectionError", () => {
  it("explains that no page was saved when the webhook subscription failed", () => {
    expect(format("webhook_subscription_failed")).toBe(
      "No se pudo conectar: Meta no confirmó la suscripción al webhook de todas las páginas. Ninguna página quedó guardada."
    )
  })

  it("names the page id taken by another tenant", () => {
    expect(format("page_owned:104233889761204")).toBe(
      "No se pudo conectar: la página 104233889761204 ya pertenece a otra cuenta de Resender."
    )
  })

  it("builds the page_owned reason from a page id", () => {
    expect(format(metaPageOwnedReason("118456220134987"))).toContain(
      "la página 118456220134987"
    )
  })

  it("reports the server misconfiguration", () => {
    expect(format("configuration_failed")).toBe(
      "No se pudo conectar: el cifrado de secretos del servidor no está configurado."
    )
  })

  it("sends the user back through the Meta dialog when the session expired", () => {
    expect(format("meta_session_expired")).toBe(
      "No se pudo conectar: tu autorización de Meta venció. Vuelve a conectar Facebook."
    )
  })

  it("explains a state mismatch as an expired authorization session", () => {
    expect(format("state_mismatch")).toBe(
      "No se pudo conectar: la sesión de autorización venció o no coincide. Inténtalo de nuevo."
    )
  })

  it("names the failing step of the Instagram connection", () => {
    expect(format("instagram_exchange_failed")).toBe(
      "No se pudo conectar: Instagram no completó el intercambio de credenciales. Vuelve a intentarlo."
    )
    expect(format("instagram_profile_failed")).toContain(
      "no devolvió su perfil"
    )
    expect(format("instagram_subscription_failed")).toContain(
      "La cuenta no quedó conectada."
    )
  })

  it("names the Instagram account taken by another tenant", () => {
    expect(format(instagramAccountOwnedReason("17841400000000000"))).toBe(
      "No se pudo conectar: la cuenta de Instagram 17841400000000000 ya pertenece a otra cuenta de Resender."
    )
  })

  // Los dos prefijos de propiedad conviven: el de Instagram no puede caer en la
  // rama de `page_owned:` ni al revés, o el mensaje nombraría el canal
  // equivocado.
  it("keeps the two ownership prefixes apart", () => {
    expect(format(metaPageOwnedReason("999"))).toContain("la página 999")
    expect(format(instagramAccountOwnedReason("999"))).toContain(
      "la cuenta de Instagram 999"
    )
  })

  // El gate de canal (ADR 0010) rebota por la misma vía que los fallos de Meta,
  // así que necesita su propia redacción: sin ella la pantalla mostraría
  // `instagram_not_enabled` crudo, que no le dice nada al que lo lee.
  it("explains that the Instagram channel is not enabled for the account", () => {
    expect(format("instagram_not_enabled")).toBe(
      "No se pudo conectar: el canal de Instagram no está habilitado para tu cuenta."
    )
  })

  // El rebote por cupo del callback (ADR 0011). Habla de conexiones porque el
  // slot ocupado puede ser una Página de Facebook y no una cuenta de Instagram.
  it("explains that the plan has no free connection slot left", () => {
    expect(format("instagram_page_limit_reached")).toBe(
      "No se pudo conectar: el cupo de conexiones de tu plan está completo. Desconecta una conexión en Conexiones para liberar cupo."
    )
  })

  it("falls back to the raw reason and to the bare message without one", () => {
    expect(format("something_odd")).toBe("No se pudo conectar: something_odd.")
    expect(format()).toBe("No se pudo conectar.")
    expect(format(null)).toBe("No se pudo conectar.")
    expect(format("")).toBe("No se pudo conectar.")
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
      expect(format(reason)).toMatch(/^No se pudo conectar: /)
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
      const message = format(whatsappStepFailedReason(step))
      expect(message).toMatch(/^No se pudo conectar: /)
      // Crudo significa «cayó en el default»: el motivo entero pegado al final.
      expect(message).not.toContain(`whatsapp_${step}_failed`)
    }
  })

  it("no promete que no quedó nada guardado cuando falla el history sync", () => {
    // El único paso que corre con la conexión ya persistida.
    expect(format("whatsapp_sync_request_failed")).toContain("quedó conectado")
  })

  it("nombra el phone_number_id que ya pertenece a otro tenant", () => {
    expect(format(whatsappNumberOwnedReason("109988776655"))).toBe(
      "No se pudo conectar: el número de WhatsApp 109988776655 ya pertenece a otra cuenta de Resender."
    )
  })

  it("explica el state_mismatch por la causa real: dos pestañas", () => {
    const message = format("whatsapp_state_mismatch")
    expect(message).toContain("pestaña")
    // No comparte texto con el `state_mismatch` genérico de los otros canales.
    expect(message).not.toBe(format("state_mismatch"))
  })

  it("explica el gate de canal y el cupo sin hablar de Instagram", () => {
    expect(format("whatsapp_not_enabled")).toContain("WhatsApp")
    expect(format("whatsapp_page_limit_reached")).toContain("cupo")
  })
})

describe("el mismo catálogo en inglés", () => {
  // No se reescriben los 20 casos: lo que hay que comprobar es que el mapeo
  // `reason` → clave no depende del idioma, y que ninguna rama se quedó con un
  // literal en español dentro del módulo.
  it("resuelve el motivo por su clave, no por el idioma", () => {
    expect(formatWithDict("meta_session_expired", en)).toBe(
      en.metaErrors.metaSessionExpired
    )
    expect(formatWithDict("whatsapp_state_mismatch", en)).toBe(
      en.metaErrors.whatsappStateMismatch
    )
    expect(formatWithDict(null, en)).toBe(en.metaErrors.empty)
  })

  it("interpola el id en los tres motivos que lo arrastran", () => {
    expect(
      formatWithDict(metaPageOwnedReason("104233889761204"), en)
    ).toContain("104233889761204")
    expect(
      formatWithDict(instagramAccountOwnedReason("17841400000000000"), en)
    ).toContain("17841400000000000")
    expect(
      formatWithDict(whatsappNumberOwnedReason("109988776655443"), en)
    ).toContain("109988776655443")
  })

  it("un motivo desconocido se sigue mostrando crudo", () => {
    // Es lo único que el usuario puede citarnos en un correo de soporte.
    expect(formatWithDict("motivo_inventado", en)).toContain("motivo_inventado")
  })
})
