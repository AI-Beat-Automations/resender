export type AuthInput = {
  email: string
  password: string
}

export type PasswordChangeInput = {
  password: string
}

export type AuthInputResult =
  | { ok: true; value: AuthInput }
  | { ok: false; error: string }

export type PasswordInputResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

export type PasswordChangeInputResult =
  | { ok: true; value: PasswordChangeInput }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8

export function normalizeEmail(email: unknown) {
  if (typeof email !== "string") return ""
  return email.trim().toLowerCase()
}

export function validateAuthInput(
  emailInput: unknown,
  passwordInput: unknown
): AuthInputResult {
  const email = normalizeEmail(emailInput)

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email." }
  }

  const password = validatePasswordInput(passwordInput)
  if (!password.ok) return password

  return { ok: true, value: { email, password: password.value } }
}

export function validatePasswordInput(
  passwordInput: unknown
): PasswordInputResult {
  const password = typeof passwordInput === "string" ? passwordInput : ""

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: "Password must be at least 8 characters." }
  }

  return { ok: true, value: password }
}

export function validatePasswordChangeInput(
  passwordInput: unknown,
  confirmPasswordInput: unknown
): PasswordChangeInputResult {
  const password = validatePasswordInput(passwordInput)
  if (!password.ok) return password

  const confirmPassword =
    typeof confirmPasswordInput === "string" ? confirmPasswordInput : ""
  if (password.value !== confirmPassword) {
    return { ok: false, error: "Passwords don't match." }
  }

  return { ok: true, value: { password: password.value } }
}
