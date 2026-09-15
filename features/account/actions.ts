"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { APIError } from "better-auth/api"

import { getAuth } from "@/lib/auth/auth"
import { isEmailVerified } from "@/lib/auth/email-verified"
import { isGoogleEnabled } from "@/lib/auth/google"
import { getSession, signOut } from "@/lib/auth/session"
import {
  classifyUnlinkError,
  type UnlinkError,
} from "@/lib/auth/sign-in-methods"
import { setUserPassword } from "@/lib/auth/set-password"
import { getAppDict } from "@/lib/i18n/app-dict"
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
import {
  validatePasswordChangeInput,
  type AuthInputError,
} from "@/lib/auth/validation"
import { getStripe } from "@/lib/billing/stripe"
import { describeError, log } from "@/lib/observability/logger"
import { unsubscribeChannelWebhook } from "@/lib/pages/channel-webhook"

export type DeleteAccountState = {
  error?: string
}

// El validador devuelve códigos (`lib/auth/validation`); esta tabla los lleva a
// la clave del diccionario. Es un `Record` sobre la unión: un código nuevo no
// compila hasta que alguien decida cómo se dice.
const AUTH_INPUT_KEY: Record<
  AuthInputError,
  "invalidEmail" | "passwordTooShort" | "passwordsDoNotMatch"
> = {
  invalid_email: "invalidEmail",
  password_too_short: "passwordTooShort",
  passwords_do_not_match: "passwordsDoNotMatch",
}

export type ChangePasswordState = {
  error?: string
}

export async function changePasswordAction(
  _state: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const t = await getAppDict()
  const input = validatePasswordChangeInput(
    formData.get("newPassword"),
    formData.get("confirmPassword")
  )
  if (!input.ok) return { error: t.actions[AUTH_INPUT_KEY[input.error]] }

  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  // El orden de los dos pasos que siguen es deliberado y no es reversible:
  //
  //   1. se escribe la contraseña nueva,
  //   2. se cierran las demás sesiones,
  //   3. se cierra la actual y se redirige a `/login`.
  //
  // Al revés —revocar primero— un fallo al escribir dejaría a la persona fuera
  // de todos sus dispositivos con la contraseña vieja todavía vigente: peor
  // estado que el que se quería arreglar. Y una vez escrita la contraseña **no
  // se revierte**: no hay a qué volver (el hash anterior ya no existe) y volver
  // a la contraseña vieja sería justo lo contrario de lo que la persona pidió.

  // No pide la contraseña anterior: es la regla de siempre (CONTEXT.md →
  // [Usuario MVP]) y por qué no se puede usar `auth.api.setPassword` está
  // escrito en `lib/auth/set-password.ts`.
  try {
    await setUserPassword(session.user.id, input.value.password)
  } catch (error) {
    // El caso concreto que esto atrapa: la fila de `users` ya no existe —la
    // cuenta se dio de baja desde otro dispositivo— pero el caché JWE de cinco
    // minutos todavía resuelve la sesión, así que `createAccount` viola la FK.
    // Sin este catch la acción devolvía un 500 donde el resto del archivo ya
    // sabe decir "no encontramos la cuenta". Nada se escribió: se puede
    // reintentar sin efectos.
    log({
      entrypoint: "action",
      action: "password_change",
      outcome: "failed",
      reason: "internal_error",
      tenantId: session.user.id,
      errorMessage: describeError(error),
    })
    return { error: t.actions.accountNotFound }
  }

  // Lo que la tabla de sesiones hace posible y el JWT no: un dispositivo que ya
  // no controlas pierde el acceso al cambiar la contraseña. Va **antes** del
  // signOut, que necesita la sesión actual todavía viva para identificar cuál
  // es "la otra".
  //
  // A partir de acá la contraseña nueva **ya es la válida**, así que un fallo
  // revocando no puede terminar en un 500: la persona vería un error sobre un
  // cambio que sí ocurrió y no sabría con cuál de las dos contraseñas volver a
  // entrar. Se registra el fallo —las otras sesiones siguen vivas hasta que
  // caduquen, y eso es una alarma— y el flujo sigue igual: se cierra la sesión
  // actual y se redirige a `/login`.
  try {
    await getAuth().api.revokeOtherSessions({ headers: await headers() })
  } catch (error) {
    log({
      entrypoint: "action",
      action: "session_revoke",
      outcome: "failed",
      reason: "internal_error",
      tenantId: session.user.id,
      errorMessage: describeError(error),
    })
  }

  // Y la actual también, para que el siguiente acceso use la credencial nueva.
  // `signOut` lanza el redirect, así que lo de abajo no se alcanza.
  await signOut({ redirectTo: "/login?passwordChanged=1" })
  return {}
}

export async function deleteAccountAction(
  _state: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  const context = await loadTenantDeletionContext(session.user.id)
  if (!context) return { error: t.actions.accountNotFound }

  if (
    !accountDeletionConfirmationMatches(
      formData.get("confirmEmail"),
      context.email
    )
  ) {
    return { error: t.actions.confirmEmailMismatch }
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
    return { error: t.actions.deletePrepareFailed }
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

// --- [Cuenta vinculada] (issue #98): vincular y desvincular Google ---

export type SignInMethodState = {
  error?: string
}

// A dónde vuelve el flujo de OAuth que se lanza desde Settings, bien o mal.
// La pestaña Cuenta es la que dibuja el panel y la que lee el `?error=` del
// rebote (`classifyOAuthError`, en `sign-in-methods-panel`).
const SETTINGS_ACCOUNT_TAB = "/settings?tab=cuenta"

/**
 * «Vincular» Google a la cuenta con sesión abierta. Vincular **desde acá**
 * tampoco borra la contraseña —no se borra en ningún camino— y también manda
 * el aviso al buzón: lo hace el hook `account.create.after` de
 * `lib/auth/auth.ts`, no esta acción.
 */
// Sin parámetros a propósito: no lee nada del formulario y `useActionState`
// acepta una acción con menos argumentos de los que le pasa.
export async function linkGoogleAction(): Promise<SignInMethodState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  // No debería verse: sin credenciales la fila de Google no se dibuja.
  if (!isGoogleEnabled()) return { error: t.actions.googleNotConfigured }

  // **Acá el candado es este `if`, no la librería.** `requireLocalEmailVerified`
  // vive en `oauth2/link-account.mjs`, el camino de `signInSocial` (el botón
  // de `/login`); el camino de `linkSocialAccount` pasa por la rama `link` del
  // callback, que solo exige que los correos coincidan y que el perfil de
  // Google venga verificado, y **nunca mira** `email_verified` de la cuenta
  // local. Vincular con el correo sin confirmar no habilita ningún robo —solo
  // se vincula una cuenta de Google con el mismo correo—, pero rompería la
  // regla de [Cuenta vinculada]. Se lee viva, por el cache de cinco minutos.
  if (!(await isEmailVerified(session.user.id))) {
    return { error: t.actions.oauthAccountNotLinked }
  }

  let url: string | undefined
  try {
    const result = await getAuth().api.linkSocialAccount({
      body: {
        provider: "google",
        callbackURL: SETTINGS_ACCOUNT_TAB,
        errorCallbackURL: SETTINGS_ACCOUNT_TAB,
        // La librería devuelve la URL en vez de contestar con `Location`: el
        // redirect lo hace Next, abajo y fuera del `try`.
        disableRedirect: true,
      },
      // Por acá ve la sesión y escribe la cookie del `state` de OAuth.
      headers: await headers(),
    })
    url = result.url
  } catch (error) {
    if (error instanceof APIError) return { error: t.actions.linkFailed }
    throw error
  }

  if (!url) return { error: t.actions.linkFailed }

  // Fuera del `try`: `redirect()` funciona lanzando y el catch lo tragaría.
  redirect(url)
}

// Código de `lib/auth/sign-in-methods` → clave del diccionario. `Record`
// sobre la unión: un código nuevo no compila hasta que alguien decida cómo
// se dice.
const UNLINK_ERROR_KEY: Record<
  UnlinkError,
  "unlinkLastCredential" | "sessionNotFresh" | "accountNotFound" | "linkFailed"
> = {
  last_credential: "unlinkLastCredential",
  session_not_fresh: "sessionNotFresh",
  account_not_found: "accountNotFound",
  unknown: "linkFailed",
}

/**
 * «Desvincular» Google. Dos cosas que la librería impone y se reflejan en el
 * copy en vez de pelearlas: exige **sesión fresca** (`freshSessionMiddleware`)
 * y **se niega a quitar la última credencial**. El panel ya no ofrece el botón
 * cuando Google es la única; este mapeo cubre la carrera entre dos pestañas.
 */
export async function unlinkGoogleAction(
  _state: SignInMethodState,
  formData: FormData
): Promise<SignInMethodState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  // Id de la **fila** de `auth_accounts` (`listUserAccounts().id`), que es lo
  // que `unlinkAccount` compara; no el `sub` de Google.
  const accountId = formData.get("accountId")
  if (typeof accountId !== "string" || !accountId) {
    return { error: t.actions.accountNotFound }
  }

  try {
    // El dueño lo resuelve la librería desde la cookie: `accountId` de otra
    // cuenta no aparece entre las de esta sesión y cae en `ACCOUNT_NOT_FOUND`.
    await getAuth().api.unlinkAccount({
      body: { accountId },
      headers: await headers(),
    })
  } catch (error) {
    if (error instanceof APIError) {
      return {
        error:
          t.actions[UNLINK_ERROR_KEY[classifyUnlinkError(error.body?.code)]],
      }
    }
    throw error
  }

  // El panel se lee del servidor en cada render: con esto la fila de Google
  // vuelve a decir «No vinculado» sin recargar a mano.
  revalidatePath("/settings")
  return {}
}
