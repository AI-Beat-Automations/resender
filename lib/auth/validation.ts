export type AuthInput = {
  email: string
  password: string
}

export type PasswordChangeInput = {
  password: string
}

/**
 * Por qué no vale la entrada. Es un **código y no un mensaje** porque estos
 * validadores los comparten dos superficies con idiomas distintos: el registro
 * del sitio público, donde el idioma es el path (`/register` vs `/en/register`),
 * y el cambio de contraseña de Ajustes, donde sale de la cookie. Devolver texto
 * obligaba a una de las dos a enseñar español (ADR 0006, «`lib/auth/validation`
 * queda como el único texto de usuario en español fuera del `Dict`»).
 *
 * Cada código dice **qué campo** falló, que es la mitad útil del error: por eso
 * son tres y no uno genérico.
 */
export type AuthInputError =
  | "invalid_email"
  | "password_too_short"
  | "passwords_do_not_match"

/**
 * El nombre tiene unión propia y **no** entra en `AuthInputError`. La razón es
 * concreta: `features/account/actions.ts` mapea `AuthInputError` entero a
 * `Record` contra el diccionario del producto, y el cambio de contraseña de
 * Ajustes no tiene campo de nombre. Sumar el código ahí obligaría a inventar un
 * texto para un error que esa pantalla no puede producir. La regla del `Record`
 * sobre la unión se conserva: quien consume esto es `features/auth/actions.ts`,
 * que sí lo mapea completo contra los dos idiomas.
 */
export type NameInputError = "name_required"

export type NameInputResult =
  | { ok: true; value: string }
  | { ok: false; error: NameInputError }

export type AuthInputResult =
  | { ok: true; value: AuthInput }
  | { ok: false; error: AuthInputError }

export type PasswordInputResult =
  | { ok: true; value: string }
  | { ok: false; error: AuthInputError }

export type PasswordChangeInputResult =
  | { ok: true; value: PasswordChangeInput }
  | { ok: false; error: AuthInputError }

// Exportado para que la lista de espera pública (ADR 0007) valide el correo con
// el mismo criterio que el registro: dos regex distintas terminarían aceptando
// en un formulario lo que el otro rechaza.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
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
    return { ok: false, error: "invalid_email" }
  }

  const password = validatePasswordInput(passwordInput)
  if (!password.ok) return password

  return { ok: true, value: { email, password: password.value } }
}

// Better Auth exige `name` en el alta (`signUpEmail`), así que el registro lo
// pide. Se valida acá y no dentro del componente porque vitest corre con
// `include: **/*.{test,spec}.ts` y no ejecuta `.tsx`: una regla dentro del
// formulario sería una regla sin test.
//
// La única regla es que no esté vacío una vez recortado. No hay tope de
// longitud ni catálogo de caracteres: el nombre no se usa para nada más que
// saludar y sacar las iniciales del avatar, y una validación más estricta
// rechazaría nombres reales antes que ataques.
export function validateNameInput(nameInput: unknown): NameInputResult {
  const name = typeof nameInput === "string" ? nameInput.trim() : ""

  if (!name) return { ok: false, error: "name_required" }

  return { ok: true, value: name }
}

export function validatePasswordInput(
  passwordInput: unknown
): PasswordInputResult {
  const password = typeof passwordInput === "string" ? passwordInput : ""

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: "password_too_short" }
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
    return { ok: false, error: "passwords_do_not_match" }
  }

  return { ok: true, value: { password: password.value } }
}
