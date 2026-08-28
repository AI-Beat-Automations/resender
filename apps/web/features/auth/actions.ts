"use server"

import { AuthError } from "next-auth"

import { signIn } from "@/auth"
import { getDictionary, type Locale } from "@/content/i18n"
import {
  createUser,
  DuplicateEmailError,
  InvalidAuthInputError,
} from "@/lib/auth/users"
import { validateAuthInput, type AuthInputError } from "@/lib/auth/validation"
import { posthog } from "@/lib/posthog"

export type AuthFormState = {
  error?: string
}

// El idioma llega en un input oculto del form (ver features/auth/ui/auth-form):
// un server action no tiene acceso al pathname de la página que lo invocó.
function localeOf(formData: FormData): Locale {
  return formData.get("locale") === "en" ? "en" : "es"
}

export async function loginAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const errors = getDictionary(localeOf(formData)).auth.errors

  const input = validateAuthInput(
    formData.get("email"),
    formData.get("password")
  )
  // En login los errores son genéricos a propósito: no confirmamos si el
  // email existe (CONTEXT.md → «Usuario MVP»).
  if (!input.ok) return { error: errors.invalidCredentials }

  try {
    await signIn("credentials", {
      email: input.value.email,
      password: input.value.password,
      redirectTo: "/connections",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: errors.invalidCredentials }
    }
    throw error
  }

  return {}
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

export async function registerAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors
  const email = formData.get("email")
  const password = formData.get("password")

  let newUser: Awaited<ReturnType<typeof createUser>> | null = null
  try {
    newUser = await createUser(email, password)
  } catch (error) {
    // En el alta, el email duplicado sí se nombra: aquí el usuario necesita
    // saber que ya tiene cuenta (CONTEXT.md → «Usuario MVP»).
    if (error instanceof DuplicateEmailError) {
      return { error: errors.duplicateEmail }
    }
    // `lib/auth/validation` devuelve un **código** y dice qué campo falló, que
    // es la mitad útil del error. Antes eso solo lo veía quien leía en español
    // —el validador devolvía su texto y el inglés caía al genérico (ADR 0006)—;
    // con el código, los dos idiomas dicen lo mismo.
    if (error instanceof InvalidAuthInputError) {
      return { error: errors[AUTH_INPUT_KEY[error.code]] }
    }
    throw error
  }

  if (posthog && newUser) {
    posthog.identify({
      distinctId: newUser.id,
      properties: { $set: { email: newUser.email } },
    })
    posthog.capture({ distinctId: newUser.id, event: "user registered" })
    await posthog.flush()
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/connections",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: errors.createdNoSignin }
    }
    throw error
  }

  return {}
}
