import { describe, expect, it } from "vitest"

import {
  CONSENT_COOKIE,
  clearConsentCookieValue,
  consentCookieValue,
  isXPixelHost,
  isXPixelPath,
  readConsent,
  resolveConsentLocale,
} from "./consent"

describe("readConsent", () => {
  it("devuelve la decisión guardada", () => {
    expect(readConsent(`${CONSENT_COOKIE}=granted`)).toBe("granted")
    expect(readConsent(`a=1; ${CONSENT_COOKIE}=denied; b=2`)).toBe("denied")
  })

  it("trata cualquier valor desconocido como sin decidir", () => {
    expect(readConsent("")).toBeNull()
    expect(readConsent("otra=granted")).toBeNull()
    expect(readConsent(`${CONSENT_COOKIE}=yes`)).toBeNull()
  })
})

describe("cookie values", () => {
  it("guarda la decisión por un año, en todo el sitio y SameSite=Lax", () => {
    expect(consentCookieValue("granted")).toBe(
      `${CONSENT_COOKIE}=granted; path=/; max-age=31536000; samesite=lax`
    )
  })

  it("borra la cookie con max-age=0", () => {
    expect(clearConsentCookieValue()).toContain("max-age=0")
    expect(readConsent(clearConsentCookieValue())).toBeNull()
  })
})

describe("isXPixelPath", () => {
  it("permite la superficie pública y el acceso", () => {
    for (const path of [
      "/",
      "/pricing",
      "/en",
      "/en/pricing",
      "/blog/x",
      "/login",
      "/register",
      "/waitlist",
      "/privacy",
    ]) {
      expect(isXPixelPath(path), path).toBe(true)
    }
  })

  it("excluye la app logueada y el billing", () => {
    for (const path of [
      "/connections",
      "/connections/select",
      "/inbox",
      "/settings",
      "/billing",
      "/billing/success",
      "/pending",
    ]) {
      expect(isXPixelPath(path), path).toBe(false)
    }
  })

  it("no confunde un prefijo con una ruta distinta", () => {
    expect(isXPixelPath("/inboxes")).toBe(true)
  })
})

describe("isXPixelHost", () => {
  it("solo acepta el dominio de producción", () => {
    expect(isXPixelHost("resender.dev")).toBe(true)
    expect(isXPixelHost("www.resender.dev")).toBe(true)
    expect(isXPixelHost("staging.resender.dev")).toBe(false)
    expect(isXPixelHost("localhost")).toBe(false)
    expect(isXPixelHost("abc.ngrok-free.dev")).toBe(false)
  })
})

describe("resolveConsentLocale", () => {
  it("en el sitio público el idioma es el path", () => {
    expect(resolveConsentLocale("/", "lang=en")).toBe("es")
    expect(resolveConsentLocale("/en/pricing", "")).toBe("en")
  })

  it("en la app usa la cookie de preferencia y cae en español", () => {
    expect(resolveConsentLocale("/inbox", "lang=en")).toBe("en")
    expect(resolveConsentLocale("/inbox", "")).toBe("es")
    expect(resolveConsentLocale("/settings", "lang=fr")).toBe("es")
  })
})
