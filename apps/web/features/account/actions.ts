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
import { getStripe } from "@/lib/billing/stripe"
import { unsubscribeChannelWebhook } from "@/lib/pages/channel-webhook"

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
  if (!session?.user?.id) return { error: "No hay sesión iniciada." }

  try {
    const user = await changeUserPassword(session.user.id, input.value.password)
    if (!user) return { error: "No encontramos la cuenta." }
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
  if (!session?.user?.id) return { error: "No hay sesión iniciada." }

  const context = await loadTenantDeletionContext(session.user.id)
  if (!context) return { error: "No encontramos la cuenta." }

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
  // Todas las conexiones del tenant se van con él. Hay que nombrarlas: en este
  // punto siguen `active` en la base, y la regla de WhatsApp —desuscribir el
  // WABA solo cuando no le quedan números activos— las contaría como vivas y no
  // desuscribiría nunca un WABA con dos números de este mismo tenant. Lo que
  // queda fuera de la lista son los números de **otros** tenants en el mismo
  // WABA, que son justo los que no hay que apagar.
  const goingAway = context.pages.map((page) => page.id)
  await Promise.allSettled(
    toUnsubscribe.map((page) =>
      unsubscribeChannelWebhook({
        channel: page.channel,
        metaPageId: page.metaPageId,
        accessToken: page.pageAccessToken,
        // Solo WhatsApp lo trae; sin él el despachador se niega a llamar en vez
        // de desuscribir el id equivocado.
        wabaId: page.wabaId,
        excludeConnectionIds: goingAway,
      })
    )
  )

  // Best-effort: cancelar la suscripción en Stripe antes de borrar; la fila de
  // `subscriptions` cae por cascade, pero sin esto Stripe seguiría cobrando a
  // una cuenta que ya no existe. Un fallo aquí tampoco bloquea el borrado.
  if (context.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.cancel(context.stripeSubscriptionId)
    } catch (error) {
      console.error(
        "stripe subscription cancel failed",
        context.stripeSubscriptionId,
        error
      )
    }
  }

  await deleteTenant(session.user.id)

  // Cierra la sesión y redirige a la landing pública. signOut lanza el redirect,
  // por lo que el código posterior no se alcanza.
  await signOut({ redirectTo: "/" })
  return {}
}
