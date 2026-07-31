"use server"

import "server-only"

import { redirect } from "next/navigation"
import {
  ChangePasswordRpcInputSchema,
  DeleteAccountRpcInputSchema,
  type AccountDeletionResultDto,
  type RpcActor,
} from "@workspace/contracts"

import { auth, signOut } from "@/auth"
import {
  BackendRpcError,
  changePassword,
  deleteAccount,
} from "@/lib/backend/backend"
import { validatePasswordChangeInput } from "@/lib/auth/validation"

export type DeleteAccountState = {
  error?: string
}

export type ChangePasswordState = {
  error?: string
}

type AccountMutationOutcome<T> =
  | { kind: "success"; value: T }
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }
  | { kind: "form_error"; error: string }

export async function changePasswordAction(
  _state: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const actor = await authenticatedActor()
  if (!actor) return { error: "No hay sesión iniciada." }

  const password = validatePasswordChangeInput(
    formData.get("newPassword"),
    formData.get("confirmPassword")
  )
  if (!password.ok) return { error: password.error }
  const input = ChangePasswordRpcInputSchema.safeParse({
    newPassword: password.value.password,
  })
  if (!input.success) {
    return { error: "La contraseña debe tener al menos 8 caracteres." }
  }

  const outcome = await performAccountMutation(
    () => changePassword(actor, input.data),
    "No pudimos guardar esa contraseña."
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  if (outcome.kind === "form_error") return { error: outcome.error }

  await signOut({ redirectTo: "/login?passwordChanged=1" })
  return {}
}

export async function deleteAccountAction(
  _state: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  const actor = await authenticatedActor()
  if (!actor) return { error: "No hay sesión iniciada." }

  const input = DeleteAccountRpcInputSchema.safeParse({
    confirmEmail: formData.get("confirmEmail"),
  })
  if (!input.success) {
    return {
      error: "El email no coincide. Escribe tu email exacto para confirmar.",
    }
  }

  const outcome = await performAccountMutation(
    () => deleteAccount(actor, input.data),
    "El email no coincide. Escribe tu email exacto para confirmar."
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  if (outcome.kind === "form_error") return { error: outcome.error }
  reportCleanupOutcome(outcome.value)
  if (!outcome.value.deleted) {
    return {
      error:
        "No pudimos eliminar la cuenta. Tu cuenta, tus datos y tu sesión siguen activos. Contacta a soporte antes de volver a intentarlo.",
    }
  }

  await signOut({ redirectTo: "/" })
  return {}
}

async function authenticatedActor(): Promise<RpcActor | null> {
  const session = await auth()
  return session?.user?.id ? { userId: session.user.id } : null
}

async function performAccountMutation<T>(
  operation: () => Promise<T>,
  validationError: string
): Promise<AccountMutationOutcome<T>> {
  try {
    return { kind: "success", value: await operation() }
  } catch (error) {
    if (!(error instanceof BackendRpcError)) throw error
    const { classification } = error
    if (classification.code === "account_waitlisted") {
      return { kind: "redirect", destination: "/waitlist" }
    }
    if (classification.code === "subscription_required") {
      return { kind: "redirect", destination: "/billing" }
    }
    if (classification.kind === "not_found") {
      return { kind: "form_error", error: "No encontramos la cuenta." }
    }
    if (classification.kind === "validation") {
      return { kind: "form_error", error: validationError }
    }
    throw error
  }
}

function reportCleanupOutcome(result: AccountDeletionResultDto) {
  console.info("Account deletion outcome.", {
    deleted: result.deleted,
    metaUnsubscribeFailures: result.metaUnsubscribeFailures,
    stripeCancellationFailed: result.stripeCancellationFailed,
  })
}
