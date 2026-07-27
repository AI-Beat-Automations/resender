"use server"

import { AuthError } from "next-auth"

import { signIn } from "@/auth"
import {
  createUser,
  DuplicateEmailError,
  InvalidAuthInputError,
} from "@/lib/auth/users"
import { validateAuthInput } from "@/lib/auth/validation"
import { posthog } from "@/lib/posthog"
import { getDictionary, type Locale } from "@/content/i18n"

export type AuthFormState = {
  error?: string
}

// El idioma llega en un input oculto del form (ver features/auth/ui/auth-form):
// un server action no tiene acceso al pathname de la página que lo invocó.
function authErrors(formData: FormData) {
  const raw = formData.get("locale")
  const locale: Locale = raw === "en" ? "en" : "es"
  return getDictionary(locale).auth.errors
}

export async function loginAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const errors = authErrors(formData)

  const input = validateAuthInput(
    formData.get("email"),
    formData.get("password")
  )
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

export async function registerAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const errors = authErrors(formData)
  const email = formData.get("email")
  const password = formData.get("password")

  let newUser: Awaited<ReturnType<typeof createUser>> | null = null
  try {
    newUser = await createUser(email, password)
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return { error: errors.duplicateEmail }
    }
    if (error instanceof InvalidAuthInputError) {
      return { error: errors.invalidInput }
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
