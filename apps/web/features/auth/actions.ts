"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { APIError } from "better-auth/api"

import { getDictionary, type Locale } from "@/content/i18n"
import { getAuth } from "@/lib/auth/auth"
import { allowAuthAttempt } from "@/lib/auth/rate-limit"
import {
  validateAuthInput,
  validateNameInput,
  type AuthInputError,
  type NameInputError,
} from "@/lib/auth/validation"
import { posthog } from "@/lib/posthog"

export type AuthFormState = {
  error?: string
}

// El idioma llega en un input oculto del form (ver features/auth/ui/auth-form):
// un server action no tiene acceso al pathname de la página que lo invocó.
function localeOf(formData: FormData): Locale {
  return formData.get("locale") === "en" ? "en" : "es"
}

// Los tres caminos de fallo del acceso —email inexistente, cuenta sin
// credencial, contraseña incorrecta— tiran el **mismo** código
// (`INVALID_EMAIL_OR_PASSWORD`), así que el mensaje genérico del login sale
// gratis: no hay forma de que este action confirme si un email existe.
export async function loginAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const errors = getDictionary(localeOf(formData)).auth.errors

  // El límite va **antes** de validar y antes de tocar la base: lo que
  // encarece un ataque por fuerza bruta es que el intento number 11 no llegue
  // a costar nada.
  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  const input = validateAuthInput(
    formData.get("email"),
    formData.get("password")
  )
  // En login los errores son genéricos a propósito: no confirmamos si el
  // email existe (CONTEXT.md → «Usuario MVP»).
  if (!input.ok) return { error: errors.invalidCredentials }

  let signedIn: { id: string; email: string } | null = null
  try {
    const result = await getAuth().api.signInEmail({
      body: {
        email: input.value.email,
        password: input.value.password,
        rememberMe: true,
      },
      // `headers` es obligatorio: de ahí salen la IP y el user agent que se
      // guardan en la fila de `auth_sessions`, y por ahí escribe la cookie el
      // plugin `nextCookies()`.
      headers: await headers(),
    })
    signedIn = { id: result.user.id, email: result.user.email }
  } catch (error) {
    if (error instanceof APIError) {
      return { error: errors.invalidCredentials }
    }
    throw error
  }

  // La identificación de PostHog vivía en el `authorize` de Auth.js, que ya no
  // existe. Se mueve acá para que el evento no se pierda con el cutover.
  if (posthog && signedIn) {
    posthog.identify({
      distinctId: signedIn.id,
      properties: { $set: { email: signedIn.email } },
    })
    posthog.capture({ distinctId: signedIn.id, event: "user logged in" })
    await posthog.flush()
  }

  // `signInEmail` no redirige: devuelve `{ redirect: false, token, url, user }`.
  // El redirect va acá y **fuera del try**, porque `redirect()` funciona
  // lanzando y un catch lo tragaría.
  redirect("/connections")
}

// Código del validador → clave del diccionario. `Record` sobre la unión: un
// código nuevo no compila hasta que alguien decida cómo se dice.
const AUTH_INPUT_KEY: Record<
  AuthInputError,
  "invalidEmail" | "passwordTooShort" | "passwordsDoNotMatch"
> = {
  invalid_email: "invalidEmail",
  password_too_short: "passwordTooShort",
  passwords_do_not_match: "passwordsDoNotMatch",
}

const NAME_INPUT_KEY: Record<NameInputError, "nameRequired"> = {
  name_required: "nameRequired",
}

export async function registerAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors

  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  // El nombre se valida primero porque es el campo nuevo y el más fácil de
  // dejar vacío; los otros dos conservan el orden y los códigos de siempre.
  const name = validateNameInput(formData.get("name"))
  if (!name.ok) return { error: errors[NAME_INPUT_KEY[name.error]] }

  const input = validateAuthInput(
    formData.get("email"),
    formData.get("password")
  )
  // `lib/auth/validation` devuelve un **código** y dice qué campo falló, que es
  // la mitad útil del error. En el alta sí se nombra el campo: acá la persona
  // necesita poder corregirlo (CONTEXT.md → «Usuario MVP»).
  if (!input.ok) return { error: errors[AUTH_INPUT_KEY[input.error]] }

  let created: { id: string; email: string } | null = null
  try {
    // `signUpEmail` crea el usuario **y** abre la sesión en una sola llamada,
    // así que ya no existe el estado intermedio «cuenta creada, sesión no».
    // `name` es obligatorio para la librería.
    const result = await getAuth().api.signUpEmail({
      body: {
        name: name.value,
        email: input.value.email,
        password: input.value.password,
      },
      headers: await headers(),
    })
    if (!result.token) return { error: errors.createdNoSignin }
    created = { id: result.user.id, email: result.user.email }
  } catch (error) {
    if (error instanceof APIError) {
      // En el alta, el email duplicado sí se nombra: aquí el usuario necesita
      // saber que ya tiene cuenta. Se ramifica **solo** sobre ese código; el
      // resto cae al genérico para no convertir el registro en un oráculo.
      if (error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        return { error: errors.duplicateEmail }
      }
      return { error: errors.invalidInput }
    }
    throw error
  }

  if (posthog && created) {
    posthog.identify({
      distinctId: created.id,
      properties: { $set: { email: created.email } },
    })
    posthog.capture({ distinctId: created.id, event: "user registered" })
    await posthog.flush()
  }

  redirect("/connections")
}
