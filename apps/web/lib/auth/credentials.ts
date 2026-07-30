import "server-only"

import { authenticateCredentials } from "@/lib/backend/backend"

import { validateAuthInput } from "./validation"

export async function authorizeCredentials(
  emailInput: unknown,
  passwordInput: unknown
) {
  const input = validateAuthInput(emailInput, passwordInput)
  if (!input.ok) return null

  const user = await authenticateCredentials(input.value)
  if (!user) return null

  return {
    id: user.id,
    email: user.email,
  }
}
