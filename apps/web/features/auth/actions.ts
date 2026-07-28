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

export type AuthFormState = {
  error?: string
}

export async function loginAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const input = validateAuthInput(
    formData.get("email"),
    formData.get("password")
  )
  // En login los errores son genéricos a propósito: no confirmamos si el
  // email existe (CONTEXT.md → «Usuario MVP»).
  if (!input.ok) return { error: "Email o contraseña incorrectos." }

  try {
    await signIn("credentials", {
      email: input.value.email,
      password: input.value.password,
      redirectTo: "/connections",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Email o contraseña incorrectos." }
    }
    throw error
  }

  return {}
}

export async function registerAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = formData.get("email")
  const password = formData.get("password")

  let newUser: Awaited<ReturnType<typeof createUser>> | null = null
  try {
    newUser = await createUser(email, password)
  } catch (error) {
    // En el alta, el email duplicado sí se nombra: aquí el usuario necesita
    // saber que ya tiene cuenta (CONTEXT.md → «Usuario MVP»).
    if (error instanceof DuplicateEmailError) {
      return { error: "Ese email ya está registrado. Inicia sesión." }
    }
    // `lib/auth/validation` ya devuelve su texto en español y solo lo consume
    // la web, así que se propaga tal cual: dice qué campo falló.
    if (error instanceof InvalidAuthInputError) {
      return { error: error.message }
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
      return {
        error:
          "Creamos tu cuenta, pero no pudimos iniciar la sesión. Entra desde Iniciar sesión.",
      }
    }
    throw error
  }

  return {}
}
