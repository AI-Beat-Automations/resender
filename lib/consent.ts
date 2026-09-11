// Consentimiento de cookies de medición: la regla pura, sin DOM. La UI
// (`components/cookie-consent.tsx`) y el pixel (`components/x-pixel.tsx`) solo
// consumen estas funciones, y vitest las cubre sin navegador.
//
// Gobierna dos cosas a la vez: PostHog (analítica de producto) y el pixel de X
// (medición de anuncios). Sin decisión, ninguno captura nada.

import { localeFromPathname, type Locale } from "@/content/i18n"
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/locale-cookie"

export const CONSENT_COOKIE = "resender_consent"

// Un año. Es el plazo habitual para un banner de cookies y suficiente para que
// no reaparezca en cada visita.
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export type ConsentDecision = "granted" | "denied"

/** `null` cuando el visitante todavía no decidió: el banner debe mostrarse. */
export type ConsentState = ConsentDecision | null

export function isConsentDecision(value: unknown): value is ConsentDecision {
  return value === "granted" || value === "denied"
}

/**
 * Lee la decisión desde el string `document.cookie`. Cualquier valor que no sea
 * una decisión conocida cuenta como «sin decidir»: la cookie es entrada del
 * usuario, no un contrato.
 */
export function readConsent(cookieString: string): ConsentState {
  const value = readCookie(cookieString, CONSENT_COOKIE)
  return isConsentDecision(value) ? value : null
}

/** Valor listo para asignar a `document.cookie` al guardar la decisión. */
export function consentCookieValue(decision: ConsentDecision): string {
  return `${CONSENT_COOKIE}=${decision}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE}; samesite=lax`
}

/** Valor listo para asignar a `document.cookie` al borrar la decisión. */
export function clearConsentCookieValue(): string {
  return `${CONSENT_COOKIE}=; path=/; max-age=0; samesite=lax`
}

// Rutas del producto y del billing. El pixel de X mide anuncios: solo tiene
// sentido en la superficie pública y en el acceso, nunca dentro de la app.
export const X_PIXEL_PRIVATE_PREFIXES = [
  "/connections",
  "/inbox",
  "/settings",
  "/billing",
  "/pending",
] as const

export function isXPixelPath(pathname: string): boolean {
  return !X_PIXEL_PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

// Solo producción. `NODE_ENV` no sirve para distinguirla: el Worker de staging
// se construye igual que el productivo. Se decide por el host del navegador,
// así localhost, el túnel de ngrok y staging.resender.dev quedan fuera sin
// ninguna variable de entorno.
export const X_PIXEL_PRODUCTION_HOSTS = ["resender.dev", "www.resender.dev"]

export function isXPixelHost(hostname: string): boolean {
  return X_PIXEL_PRODUCTION_HOSTS.includes(hostname)
}

/**
 * Idioma del banner. En el sitio público el idioma es el path (`/en`); dentro
 * de la app no hay prefijo y el idioma vive en la cookie de preferencia, la
 * misma que lee `resolveAppLocale` en el servidor.
 */
export function resolveConsentLocale(
  pathname: string,
  cookieString: string
): Locale {
  if (isXPixelPath(pathname)) return localeFromPathname(pathname)
  const preferred = readCookie(cookieString, LOCALE_COOKIE)
  return isLocale(preferred) ? preferred : "es"
}

function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}
