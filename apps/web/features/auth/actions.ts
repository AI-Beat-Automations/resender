"use server"

import { CredentialsSignin } from "next-auth"

import { signIn } from "@/auth"
import { getDictionary, type Locale } from "@/content/i18n"
import { BackendRpcError, registerUser } from "@/lib/backend/backend"
import { validateAuthInput } from "@/lib/auth/validation"
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
    if (error instanceof CredentialsSignin) {
      return { error: errors.invalidCredentials }
    }
    throw error
  }

  return {}
}

export async function registerAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors
  const email = formData.get("email")
  const password = formData.get("password")
  const input = validateAuthInput(email, password)

  if (!input.ok) {
    return {
      error: locale === "es" ? input.error : errors.invalidInput,
    }
  }

  let newUser: Awaited<ReturnType<typeof registerUser>>
  try {
    newUser = await registerUser(input.value)
  } catch (error) {
    // En el alta, el email duplicado sí se nombra: aquí el usuario necesita
    // saber que ya tiene cuenta (CONTEXT.md → «Usuario MVP»).
    if (
      error instanceof BackendRpcError &&
      error.classification.code === "validation_error" &&
      error.classification.status === 409
    ) {
      return { error: errors.duplicateEmail }
    }
    throw error
  }

  if (posthog) {
    posthog.identify({
      distinctId: newUser.id,
      properties: { $set: { email: newUser.email } },
    })
    posthog.capture({ distinctId: newUser.id, event: "user registered" })
    await posthog.flush()
  }

  try {
    await signIn("credentials", {
      email: input.value.email,
      password: input.value.password,
      redirectTo: "/connections",
    })
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return { error: errors.createdNoSignin }
    }
    throw error
  }

  return {}
}
