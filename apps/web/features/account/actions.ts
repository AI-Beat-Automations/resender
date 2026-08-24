"use server"

import { auth, signOut } from "@/auth"
import {
  accountDeletionConfirmationMatches,
  deletedConnectionIds,
  planWebhookUnsubscribes,
} from "@/lib/account/account-deletion"
import {
  deleteTenant,
  loadTenantDeletionContext,
} from "@/lib/account/account-repository"
import {
  enqueueMediaPurge,
  insertPendingMediaDeletion,
  tenantMediaPrefix,
} from "@/lib/account/media-purge"
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

  // Paso 1 de 3 del borrado de media: dejar escrito el prefijo R2 del tenant
  // ANTES de tocar nada. `pending_media_deletions` no tiene FK a `users` a
  // propósito (migración 0017, sección 8): es lo único que sobrevive al cascade
  // y, por tanto, lo único que después del DELETE recuerda qué bytes hay que
  // borrar. Si esto falla, se aborta sin efectos: preferimos una cuenta que
  // sigue existiendo y se puede reintentar borrar, a una cuenta borrada cuya
  // media queda huérfana en R2 sin puntero.
  const mediaPrefix = tenantMediaPrefix(session.user.id)
  try {
    await insertPendingMediaDeletion(mediaPrefix)
  } catch (error) {
    console.error("pending media deletion insert failed", mediaPrefix, error)
    return {
      error:
        "No pudimos preparar el borrado. Vuelve a intentarlo en un minuto.",
    }
  }

  // Best-effort: dejar de recibir mensajes de Meta antes de borrar. Un fallo
  // aquí no debe bloquear el borrado de datos del tenant.
  //
  // `excludeConnectionIds` son todas las conexiones del tenant, que el cascade
  // se va a llevar en unos milisegundos. Sin eso, la cuenta de números activos
  // del WABA se contaría a sí misma —las filas todavía dicen `active`— y un
  // tenant con un solo número no desuscribiría nunca, dejando el WABA mandando
  // eventos de un cliente que ya no existe.
  const excludeConnectionIds = deletedConnectionIds(context.pages)
  const toUnsubscribe = planWebhookUnsubscribes(context.pages)
  await Promise.allSettled(
    toUnsubscribe.map((page) =>
      unsubscribeChannelWebhook({
        channel: page.channel,
        metaPageId: page.metaPageId,
        accessToken: page.pageAccessToken,
        wabaId: page.wabaId,
        excludeConnectionIds,
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

  // Paso 2: el borrado en sí. La fila de `pending_media_deletions` no cae con
  // el cascade porque no tiene FK a `users`.
  await deleteTenant(session.user.id)

  // Paso 3: encolar el vaciado de R2. Va último y es best-effort, y el orden no
  // es cosmético: si el `send` falla, la fila del paso 1 sigue ahí y el cron la
  // reclama, así que lo peor que pasa es que los bytes se borren más tarde. Al
  // revés —encolar antes del DELETE— un fallo del DELETE dejaría un tenant vivo
  // con su media purgada, que es un daño que no se deshace.
  try {
    await enqueueMediaPurge({ prefix: mediaPrefix })
  } catch (error) {
    console.error("media purge enqueue failed", mediaPrefix, error)
  }

  // Cierra la sesión y redirige a la landing pública. signOut lanza el redirect,
  // por lo que el código posterior no se alcanza.
  await signOut({ redirectTo: "/" })
  return {}
}
