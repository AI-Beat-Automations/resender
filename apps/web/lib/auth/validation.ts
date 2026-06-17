export type AuthInput = {
  email: string
  password: string
}

export type AuthInputResult =
  | { ok: true; value: AuthInput }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(email: unknown) {
  if (typeof email !== "string") return ""
  return email.trim().toLowerCase()
}

export function validateAuthInput(
  emailInput: unknown,
  passwordInput: unknown
): AuthInputResult {
  const email = normalizeEmail(emailInput)
  const password = typeof passwordInput === "string" ? passwordInput : ""

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Ingresa un email valido." }
  }

  if (password.length < 8) {
    return { ok: false, error: "El password debe tener al menos 8 caracteres." }
  }

  return { ok: true, value: { email, password } }
}
