import { EMAIL_RE, normalizeEmail } from "@/lib/auth/validation"

// Claves de `heard_from`, nunca etiquetas traducidas (ADR 0007): el formulario
// es bilingüe y guardar el label metería el mismo canal dos veces según el
// idioma. Las etiquetas las resuelve el diccionario.
export const HEARD_FROM_KEYS = [
  "tiktok",
  "instagram",
  "x",
  "youtube",
  "linkedin",
  "event",
  "other",
] as const
export type HeardFrom = (typeof HEARD_FROM_KEYS)[number]

export const WAITLIST_SOURCES = ["landing", "waitlist_page"] as const
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number]

export const HEARD_FROM_OTHER_MAX_LENGTH = 120
export const CONSENT_VERSION = "2026-08"

// Valores que un checkbox HTML puede llegar a mandar como "marcado": el nativo
// manda "on", pero un formulario controlado puede mandar "true" o el booleano.
const CONSENT_TRUTHY = ["on", "true"]

// Claves de error, no mensajes: esta es una superficie pública bilingüe, así que
// el texto lo resuelve el diccionario en la server action (ADR 0006).
export type WaitlistFieldError =
  | "email"
  | "heardFrom"
  | "heardFromOther"
  | "heardFromOtherTooLong"
  | "consent"

export type WaitlistInput = {
  email: string
  heardFrom: HeardFrom
  heardFromOther: string | null
}

export type WaitlistInputResult =
  | { ok: true; value: WaitlistInput }
  | { ok: false; error: WaitlistFieldError }

export function validateWaitlistInput(input: {
  email: unknown
  heardFrom: unknown
  heardFromOther: unknown
  consent: unknown
}): WaitlistInputResult {
  const email = normalizeEmail(input.email)
  if (!EMAIL_RE.test(email)) return { ok: false, error: "email" }

  // El consentimiento es bloqueante (ADR 0007): una fila sin consentimiento
  // sería una fila a la que no se le puede escribir, y guardarla es peor que
  // perder el registro.
  if (!isConsentGiven(input.consent)) return { ok: false, error: "consent" }

  if (!isHeardFrom(input.heardFrom)) return { ok: false, error: "heardFrom" }
  const heardFrom = input.heardFrom

  // Con cualquier clave que no sea `other` el texto libre se descarta: si la
  // persona escribió algo y después cambió el selector, el navegador igual manda
  // el campo, y guardarlo dejaría filas con un detalle que no corresponde al
  // canal elegido.
  if (heardFrom !== "other") {
    return { ok: true, value: { email, heardFrom, heardFromOther: null } }
  }

  const heardFromOther =
    typeof input.heardFromOther === "string" ? input.heardFromOther.trim() : ""
  if (!heardFromOther) return { ok: false, error: "heardFromOther" }
  if (heardFromOther.length > HEARD_FROM_OTHER_MAX_LENGTH) {
    return { ok: false, error: "heardFromOtherTooLong" }
  }

  return { ok: true, value: { email, heardFrom, heardFromOther } }
}

// El servidor decide el valor guardado desde un conjunto cerrado: el `source`
// viaja en un campo oculto y cualquiera puede editarlo, así que un valor
// desconocido cae en "landing" en vez de guardarse crudo y romper el `group by`.
export function normalizeWaitlistSource(input: unknown): WaitlistSource {
  return isWaitlistSource(input) ? input : "landing"
}

// Campo trampa: los bots completan todos los inputs del formulario, incluido el
// que está oculto por CSS. Si viene con contenido, la acción devuelve éxito
// aparente sin escribir nada (ADR 0007).
export function isHoneypotFilled(input: unknown): boolean {
  return typeof input === "string" && input.trim().length > 0
}

function isConsentGiven(input: unknown) {
  if (input === true) return true
  return typeof input === "string" && CONSENT_TRUTHY.includes(input.trim())
}

function isHeardFrom(input: unknown): input is HeardFrom {
  return (
    typeof input === "string" &&
    (HEARD_FROM_KEYS as readonly string[]).includes(input)
  )
}

function isWaitlistSource(input: unknown): input is WaitlistSource {
  return (
    typeof input === "string" &&
    (WAITLIST_SOURCES as readonly string[]).includes(input)
  )
}
