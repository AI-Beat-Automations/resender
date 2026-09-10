import { localePath } from "@/content/i18n"
import { resolveEmailLocale } from "@/lib/auth/email-locale"
import { sendAccountLinkedEmail } from "@/lib/email/account-linked-email"
import { describeError, log } from "@/lib/observability/logger"

// El aviso de [Cuenta vinculada] (issue #98): cuando Google se suma a una
// cuenta que **ya tenía** contraseña, sale un correo que lo dice. Es la
// mitigación que reemplaza al borrado de la credencial: no se le quita a nadie
// una forma de entrar, pero el dueño del correo se entera de que apareció
// otra.
//
// Lo dispara `databaseHooks.account.create.after` en `lib/auth/auth.ts`, y ese
// hook corre en **toda** creación de cuenta: la fila `credential` del alta
// normal, la que crea `resetPassword`/`setUserPassword`, y la fila `google`
// del alta por Google. Por eso la condición vive acá, en su propio módulo
// `.ts`, y no inline en el objeto de config: es la regla más testeable de la
// entrega y sin las dos mitades se le manda un aviso a gente que se acaba de
// registrar.

// El nombre del proveedor tal como lo escribe la librería en
// `auth_accounts.provider_id`.
const GOOGLE_PROVIDER_ID = "google"

/** El pedazo de la fila de `auth_accounts` del que depende la decisión. */
export type LinkedAccountInput = {
  providerId: string
  userId: string
}

/**
 * Lo que este módulo usa de `ctx.context.internalAdapter`. Es API interna de
 * Better Auth y su superficie cambió entre minors, así que —igual que en
 * `set-password.ts`— se declara la forma mínima acá y el hook la castea: un
 * bump de versión se arregla en este archivo.
 */
export type LinkedAccountAdapter = {
  findCredentialAccount: (userId: string) => Promise<unknown>
  findUserById: (
    id: string
  ) => Promise<{ email: string; name?: string | null } | null | undefined>
}

/**
 * La regla: avisar solo si la fila nueva es de Google **y** ya existía una
 * credencial con contraseña para ese usuario. Sin la segunda mitad, el alta
 * por Google —que no tiene contraseña— recibiría un aviso de algo que no pasó.
 */
export async function shouldNotifyAccountLinked(
  account: LinkedAccountInput,
  adapter: Pick<LinkedAccountAdapter, "findCredentialAccount">
): Promise<boolean> {
  if (account.providerId !== GOOGLE_PROVIDER_ID) return false
  const credential = await adapter.findCredentialAccount(account.userId)
  return Boolean(credential)
}

/**
 * El contexto que el hook recibe. `request` solo existe cuando la llamada
 * entró por HTTP —el callback de Google sí, un server action no—; `context`
 * es el `AuthContext` de la librería. La forma es estructural y mínima a
 * propósito, para que el test le pase una de juguete.
 */
export type LinkedAccountHookContext = {
  request?: Request | null
  context: { internalAdapter: LinkedAccountAdapter }
}

/**
 * Decide y, si corresponde, manda el aviso. **Nunca lanza**: el hook corre
 * antes de que se acuñe la sesión del login que lo disparó, y una excepción
 * acá revienta el callback de OAuth y deja a la persona afuera de un login
 * que ya era exitoso. Un correo que no sale se registra y no se le informa a
 * nadie.
 */
export async function notifyAccountLinked(
  account: LinkedAccountInput,
  ctx: LinkedAccountHookContext | null | undefined
): Promise<void> {
  try {
    // La mitad barata primero: para las filas `credential` —la enorme mayoría
    // de lo que pasa por acá— no se toca la base ni hace falta contexto.
    if (account.providerId !== GOOGLE_PROVIDER_ID) return

    // Sin contexto no hay adaptador con el que mirar la credencial. No pasa en
    // 1.7.2: las dos rutas que crean una fila `google` (el callback de
    // `signInSocial` y el de `linkSocialAccount`) son endpoints HTTP y siempre
    // traen `ctx`. Si un bump lo cambia, se ve en el log en vez de romper el
    // login.
    const adapter = ctx?.context?.internalAdapter
    if (!adapter) {
      log({
        entrypoint: "action",
        action: "email_send",
        outcome: "failed",
        reason: "internal_error",
        tenantId: account.userId,
        errorMessage:
          "account.create.after ran without endpoint context: " +
          "cannot check the credential account",
      })
      return
    }

    if (!(await shouldNotifyAccountLinked(account, adapter))) return

    const user = await adapter.findUserById(account.userId)
    if (!user) {
      log({
        entrypoint: "action",
        action: "email_send",
        outcome: "failed",
        reason: "internal_error",
        tenantId: account.userId,
        errorMessage: "account linked to a user that does not exist",
      })
      return
    }

    // `BETTER_AUTH_URL` y **nunca `APP_URL`**, por la misma razón que en
    // `sendResetPassword`: es el origen real de la sesión en los dos entornos.
    // Sin él no se manda nada: un enlace relativo a `/forgot-password` sale
    // como `http:///forgot-password` en el cliente de correo.
    const base = process.env.BETTER_AUTH_URL
    if (!base) {
      log({
        entrypoint: "action",
        action: "email_send",
        outcome: "failed",
        reason: "not_configured",
        tenantId: account.userId,
        errorMessage:
          "BETTER_AUTH_URL is not set: no origin for the forgot-password link",
      })
      return
    }

    const locale = await resolveEmailLocale(ctx?.request)

    // El `{googleEmail}` del correo es `user.email`, el de la cuenta de
    // Resender, y no `account.accountId`: en la fila de Google `account_id`
    // guarda el `sub` (un id numérico), no la dirección. Los dos correos son
    // el mismo por construcción: la librería solo vincula cuando coinciden
    // (`oauth2/link-account.mjs`).
    const result = await sendAccountLinkedEmail({
      to: user.email,
      locale,
      googleEmail: user.email,
      // «Si no fuiste tú, cambia tu contraseña»: la [Recuperacion de password]
      // ya revoca todas las sesiones, así que le da a la víctima autoservicio
      // para expulsar al atacante sin esperar soporte.
      forgotPasswordUrl: `${base}${localePath("/forgot-password", locale)}`,
    })

    // `sendTemplateEmail` nunca lanza: el fallo llega como dato y se registra,
    // que es lo único que hace visible una caída de Resend.
    if (!result.ok) {
      log({
        entrypoint: "action",
        action: "email_send",
        outcome: "failed",
        reason: result.reason ?? "internal_error",
        status: result.status,
        tenantId: account.userId,
        errorMessage: result.error ?? undefined,
      })
    }
  } catch (error) {
    log({
      entrypoint: "action",
      action: "email_send",
      outcome: "failed",
      reason: "internal_error",
      tenantId: account.userId,
      errorMessage: describeError(error),
    })
  }
}
