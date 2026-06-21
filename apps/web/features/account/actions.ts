"use server"

import { auth, signOut } from "@/auth"
import {
  accountDeletionConfirmationMatches,
  planWebhookUnsubscribes,
} from "@/lib/account/account-deletion"
import {
  deleteTenant,
  loadTenantDeletionContext,
} from "@/lib/account/account-repository"
import { changeUserPassword, InvalidAuthInputError } from "@/lib/auth/users"
import { validatePasswordChangeInput } from "@/lib/auth/validation"
import { unsubscribeFromWebhook } from "@/lib/meta"

export type DeleteAccountState = {
  error?: string
}

export type ChangePasswordState = {
  error?: string
}

export async function changePasswordAction(
  _state: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const input = validatePasswordChangeInput(
    formData.get("newPassword"),
    formData.get("confirmPassword")
  )
  if (!input.ok) return { error: input.error }

  const session = await auth()
  if (!session?.user?.id) return { error: "No autenticado." }

  try {
    const user = await changeUserPassword(session.user.id, input.value.password)
    if (!user) return { error: "Cuenta no encontrada." }
  } catch (error) {
    if (error instanceof InvalidAuthInputError) {
      return { error: error.message }
    }
    throw error
  }

  // El password ya cambió; cerramos la sesión actual para que el siguiente
  // acceso use la credencial nueva.
  await signOut({ redirectTo: "/login?passwordChanged=1" })
  return {}
}

export async function deleteAccountAction(
  _state: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autenticado." }

  const context = await loadTenantDeletionContext(session.user.id)
  if (!context) return { error: "Cuenta no encontrada." }

  if (
    !accountDeletionConfirmationMatches(
      formData.get("confirmEmail"),
      context.email
    )
  ) {
    return {
      error: "El email no coincide. Escribe tu email exacto para confirmar.",
    }
  }

  // Best-effort: dejar de recibir mensajes de Meta antes de borrar. Un fallo
  // aquí no debe bloquear el borrado de datos del tenant.
  const toUnsubscribe = planWebhookUnsubscribes(context.pages)
  await Promise.allSettled(
    toUnsubscribe.map((page) =>
      unsubscribeFromWebhook(page.metaPageId, page.pageAccessToken)
    )
  )

  await deleteTenant(session.user.id)

  // Cierra la sesión y redirige a la landing pública. signOut lanza el redirect,
  // por lo que el código posterior no se alcanza.
  await signOut({ redirectTo: "/" })
  return {}
}
