"use server"

import { AuthError } from "next-auth"

import { signIn } from "@/auth"
import {
  createUser,
  DuplicateEmailError,
  InvalidAuthInputError,
} from "@/lib/auth/users"
import { validateAuthInput } from "@/lib/auth/validation"

export type AuthFormState = {
  error?: string
}

export async function loginAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const input = validateAuthInput(formData.get("email"), formData.get("password"))
  if (!input.ok) return { error: "Incorrect email or password." }

  try {
    await signIn("credentials", {
      email: input.value.email,
      password: input.value.password,
      redirectTo: "/connections",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." }
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

  try {
    await createUser(email, password)
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return { error: "That email is already registered. Sign in." }
    }
    if (error instanceof InvalidAuthInputError) {
      return { error: error.message }
    }
    throw error
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/connections",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "The account was created, but we couldn't sign you in." }
    }
    throw error
  }

  return {}
}
