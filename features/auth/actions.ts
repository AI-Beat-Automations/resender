"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { APIError } from "better-auth/api"

import { getDictionary, localePath, type Locale } from "@/content/i18n"
import { getAuth } from "@/lib/auth/auth"
import { isGoogleEnabled } from "@/lib/auth/google"
import { allowAuthAttempt } from "@/lib/auth/rate-limit"
import { getSession } from "@/lib/auth/session"
import {
  EMAIL_RE,
  normalizeEmail,
  validateAuthInput,
  validateNameInput,
  validatePasswordChangeInput,
  type AuthInputError,
  type NameInputError,
} from "@/lib/auth/validation"
import { posthog } from "@/lib/posthog"

export type AuthFormState = {
  error?: string
}

// El idioma llega en un input oculto del form (ver features/auth/ui/auth-form):
// un server action no tiene acceso al pathname de la página que lo invocó.
function localeOf(formData: FormData): Locale {
  return formData.get("locale") === "en" ? "en" : "es"
}

// Los tres caminos de fallo del acceso —email inexistente, cuenta sin
// credencial, contraseña incorrecta— tiran el **mismo** código
// (`INVALID_EMAIL_OR_PASSWORD`), así que el mensaje genérico del login sale
// gratis: no hay forma de que este action confirme si un email existe.
export async function loginAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const errors = getDictionary(localeOf(formData)).auth.errors

  // El límite va **antes** de validar y antes de tocar la base: lo que
  // encarece un ataque por fuerza bruta es que el intento number 11 no llegue
  // a costar nada.
  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  const input = validateAuthInput(
    formData.get("email"),
    formData.get("password")
  )
  // En login los errores son genéricos a propósito: no confirmamos si el
  // email existe (CONTEXT.md → «Usuario MVP»).
  if (!input.ok) return { error: errors.invalidCredentials }

  let signedIn: { id: string; email: string } | null = null
  try {
    const result = await getAuth().api.signInEmail({
      body: {
        email: input.value.email,
        password: input.value.password,
        rememberMe: true,
      },
      // `headers` es obligatorio: de ahí salen la IP y el user agent que se
      // guardan en la fila de `auth_sessions`, y por ahí escribe la cookie el
      // plugin `nextCookies()`.
      headers: await headers(),
    })
    signedIn = { id: result.user.id, email: result.user.email }
  } catch (error) {
    if (error instanceof APIError) {
      return { error: errors.invalidCredentials }
    }
    throw error
  }

  // La identificación de PostHog vivía en el `authorize` de Auth.js, que ya no
  // existe. Se mueve acá para que el evento no se pierda con el cutover.
  if (posthog && signedIn) {
    posthog.identify({
      distinctId: signedIn.id,
      properties: { $set: { email: signedIn.email } },
    })
    posthog.capture({ distinctId: signedIn.id, event: "user logged in" })
    await posthog.flush()
  }

  // `signInEmail` no redirige: devuelve `{ redirect: false, token, url, user }`.
  // El redirect va acá y **fuera del try**, porque `redirect()` funciona
  // lanzando y un catch lo tragaría.
  redirect("/connections")
}

// Código del validador → clave del diccionario. `Record` sobre la unión: un
// código nuevo no compila hasta que alguien decida cómo se dice.
const AUTH_INPUT_KEY: Record<
  AuthInputError,
  "invalidEmail" | "passwordTooShort" | "passwordsDoNotMatch"
> = {
  invalid_email: "invalidEmail",
  password_too_short: "passwordTooShort",
  passwords_do_not_match: "passwordsDoNotMatch",
}

const NAME_INPUT_KEY: Record<NameInputError, "nameRequired"> = {
  name_required: "nameRequired",
}

export async function registerAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors

  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  // El nombre se valida primero porque es el campo nuevo y el más fácil de
  // dejar vacío; los otros dos conservan el orden y los códigos de siempre.
  const name = validateNameInput(formData.get("name"))
  if (!name.ok) return { error: errors[NAME_INPUT_KEY[name.error]] }

  const input = validateAuthInput(
    formData.get("email"),
    formData.get("password")
  )
  // `lib/auth/validation` devuelve un **código** y dice qué campo falló, que es
  // la mitad útil del error. En el alta sí se nombra el campo: acá la persona
  // necesita poder corregirlo (CONTEXT.md → «Usuario MVP»).
  if (!input.ok) return { error: errors[AUTH_INPUT_KEY[input.error]] }

  let created: { id: string; email: string } | null = null
  try {
    // `signUpEmail` crea el usuario **y** abre la sesión en una sola llamada,
    // así que ya no existe el estado intermedio «cuenta creada, sesión no».
    // `name` es obligatorio para la librería.
    //
    // `callbackURL: "/pending"` es a donde aterriza el [Enlace de verificacion]
    // que este alta manda (`sendOnSignUp`, ver `lib/auth/auth.ts`). Es la única
    // ruta que ya hace lo correcto para todos: a quien tiene acceso lo rebota a
    // `/connections` y a quien no le muestra la espera. Si el enlace venció, la
    // librería vuelve a esta misma ruta con `?error=`, y `/pending` lo lee.
    const result = await getAuth().api.signUpEmail({
      body: {
        name: name.value,
        email: input.value.email,
        password: input.value.password,
        callbackURL: "/pending",
      },
      headers: await headers(),
    })
    if (!result.token) return { error: errors.createdNoSignin }
    created = { id: result.user.id, email: result.user.email }
  } catch (error) {
    if (error instanceof APIError) {
      // En el alta, el email duplicado sí se nombra: aquí el usuario necesita
      // saber que ya tiene cuenta. Se ramifica **solo** sobre ese código; el
      // resto cae al genérico para no convertir el registro en un oráculo.
      if (error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        return { error: errors.duplicateEmail }
      }
      return { error: errors.invalidInput }
    }
    throw error
  }

  if (posthog && created) {
    posthog.identify({
      distinctId: created.id,
      properties: { $set: { email: created.email } },
    })
    posthog.capture({ distinctId: created.id, event: "user registered" })
    await posthog.flush()
  }

  redirect("/connections")
}

// --- Recuperación de password (CONTEXT.md → [Recuperacion de password]) ---

export type ForgotPasswordState = {
  error?: string
  // `true` = "revisá tu buzón". Es el **mismo** estado exista o no la cuenta y
  // falle o no el envío: ver el comentario de `forgotPasswordAction`.
  sent?: boolean
}

/**
 * Pide un [Enlace de recuperacion]. **Devuelve siempre el mismo estado de
 * éxito**: email inválido, email inexistente y Resend caído terminan igual.
 * Resender nunca revela si un correo tiene cuenta, que es la misma regla que
 * ya protegen `loginAction` y la lista de espera pública.
 *
 * La única excepción es el 429 del rate limit, que es genérico por IP y no
 * dice nada sobre ninguna cuenta.
 */
export async function forgotPasswordAction(
  _state: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors

  // Antes de validar y antes de tocar la base, igual que los otros dos
  // actions: lo que encarece el ataque es que el intento 11 no cueste nada.
  //
  // ⚠️ **El límite es por IP y no hay tope por destinatario.** Desde IPs
  // rotativas se puede inundar el buzón de una víctima y quemar la cuota de
  // Resend. Lo sostiene `docs/adr/0014:9` ("no hay terceros en producción"),
  // que es una excusa que caduca sola: **el día que haya terceros, esto se
  // revisa**. El cooldown por destinatario se descartó a sabiendas (issue #93):
  // produce un efecto silencioso raro —el ✓ aparece y no llega nada—.
  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  const email = normalizeEmail(formData.get("email"))
  // Un email inválido tampoco es un error visible: distinguirlo del email que
  // no tiene cuenta no aporta nada y abre una diferencia observable.
  if (!EMAIL_RE.test(email)) return { sent: true }

  try {
    // `requestPasswordReset` es el nombre del endpoint en better-auth 1.7.2
    // (`/request-password-reset`); `forgetPassword` era el de las versiones
    // viejas y ya no existe.
    //
    // `redirectTo` es **la ruta localizada**, y es por donde viaja el idioma
    // hasta `sendResetPassword`: el callback de la librería solo recibe
    // `{ user, url, token }`, y el idioma sale del `callbackURL` que la
    // librería mete dentro de `url`. Ver `lib/auth/auth.ts`.
    //
    // Sin `headers`: no hace falta IP ni user agent —no se abre sesión— y sin
    // `ctx.request` la librería se saltea el chequeo de origen, que con un
    // path relativo pasaría igual.
    await getAuth().api.requestPasswordReset({
      body: {
        email,
        redirectTo: localePath("/reset-password", locale),
      },
    })
  } catch (error) {
    // Ni siquiera un `APIError` cambia lo que ve la persona. Se traga a
    // propósito: la librería ya responde 200 para el email inexistente, así
    // que lo que llega acá es un fallo real, y contarlo sería el oráculo.
    if (!(error instanceof APIError)) throw error
  }

  return { sent: true }
}

export type ResetPasswordState = {
  error?: string
}

/**
 * Consume el [Enlace de recuperacion] y escribe la contraseña nueva. El token
 * viaja en un input oculto del formulario porque el action no ve el
 * querystring de la página.
 */
export async function resetPasswordAction(
  _state: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors

  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  const token = formData.get("token")
  if (typeof token !== "string" || !token) {
    return { error: errors.resetLinkExpired }
  }

  // **Antes** de llamar a la librería, y no es opcional: `resetPassword`
  // valida con su propio `minPasswordLength` y devuelve `PASSWORD_TOO_SHORT`
  // en inglés crudo, salteándose el diccionario y la ADR 0006. Además es el
  // único sitio que compara las dos contraseñas: la librería solo recibe una.
  const input = validatePasswordChangeInput(
    formData.get("password"),
    formData.get("confirmPassword")
  )
  if (!input.ok) return { error: errors[AUTH_INPUT_KEY[input.error]] }

  try {
    await getAuth().api.resetPassword({
      body: { newPassword: input.value.password, token },
    })
  } catch (error) {
    if (error instanceof APIError) {
      // El token venció, ya se usó, o la fila del usuario no está. Los tres
      // terminan en la misma pantalla: pedir un enlace nuevo.
      return { error: errors.resetLinkExpired }
    }
    throw error
  }

  // Fuera del `try`, porque `redirect()` funciona lanzando y el catch lo
  // tragaría. `?passwordChanged=1` ya existe: es el aviso que muestra
  // `login-view` tras el cambio desde Ajustes.
  redirect(`${localePath("/login", locale)}?passwordChanged=1`)
}

// --- Google (CONTEXT.md → [Cuenta vinculada], issue #98) ---

// Desde qué pantalla salió el botón. Better Auth valida el origen del
// `errorCallbackURL`, y además el rebote con `?error=` tiene que caer en la
// pantalla donde estaba la persona, no en la otra.
function originOf(formData: FormData): "/login" | "/register" {
  return formData.get("from") === "register" ? "/register" : "/login"
}

/**
 * «Continuar con Google». Pide a la librería la URL de autorización y redirige
 * ahí. **Sin `authClient`**: el repositorio no tiene cliente de Better Auth y
 * el flujo social entero es server actions, como todo lo demás. Es deliberado
 * y hay que sostenerlo.
 */
export async function signInWithGoogleAction(
  _state: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors

  // El mismo límite por IP que el acceso y el alta, y antes de todo lo demás.
  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  // No debería verse: sin credenciales el botón no se dibuja. Pero la acción
  // existe igual y alguien puede invocarla a mano; mejor un mensaje que un
  // `PROVIDER_NOT_FOUND` crudo de la librería.
  if (!isGoogleEnabled()) return { error: errors.googleNotConfigured }

  let url: string | undefined
  try {
    const result = await getAuth().api.signInSocial({
      body: {
        provider: "google",
        // `/connections` es deliberado: **el destino lo decide el [Gate de
        // acceso], no la autenticación**, igual que en `loginAction` y
        // `registerAction`. Una cuenta nueva va a rebotar a `/pending` y eso
        // es correcto.
        callbackURL: "/connections",
        // La pantalla de origen con su prefijo de idioma: la librería valida
        // el origen del callback de error, y el `?error=` se dibuja en la
        // misma card donde estaba el botón (`lib/auth/oauth-errors.ts`).
        errorCallbackURL: localePath(originOf(formData), locale),
        // La librería devuelve la URL en vez de contestar con `Location`: el
        // redirect lo hace Next, abajo y fuera del `try`.
        disableRedirect: true,
      },
      // Por acá escribe la cookie del `state` de OAuth el plugin
      // `nextCookies()`; sin `headers` el callback no encontraría el `state`.
      headers: await headers(),
    })
    url = result.url
  } catch (error) {
    if (error instanceof APIError) {
      return { error: errors.googleNotConfigured }
    }
    throw error
  }

  // Sin URL no hay a dónde ir. No pasa con `disableRedirect: true` y un
  // proveedor registrado, pero el tipo lo admite y hay que contestar algo.
  if (!url) return { error: errors.googleNotConfigured }

  // Fuera del `try`: `redirect()` funciona lanzando y el catch lo tragaría.
  redirect(url)
}

export type ResendVerificationState = {
  error?: string
  // `true` = "te lo reenviamos". Es el **mismo** estado exista o no la cuenta:
  // ver el comentario de `resendVerificationEmailAction`.
  sent?: boolean
}

/**
 * Reenvía el correo de [Verificacion de correo]. Una sola acción para tres
 * pantallas: el aviso `account_not_linked` de `/login` (sin sesión, pide el
 * correo), el bloque de `/pending` y el panel de Settings (con sesión, el
 * correo sale de ahí y el formulario no manda ninguno).
 *
 * **Devuelve siempre `{ sent: true }`**, exista o no la cuenta y falle o no
 * el envío. Sin sesión, el endpoint de la librería ya es anti-enumeración por
 * diseño —firma un token aunque el correo no exista, para emparejar tiempos—
 * y esta acción no lo desanda. Es la misma regla que protegen `loginAction` y
 * `forgotPasswordAction`.
 */
export async function resendVerificationEmailAction(
  _state: ResendVerificationState,
  formData: FormData
): Promise<ResendVerificationState> {
  const locale = localeOf(formData)
  const errors = getDictionary(locale).auth.errors

  // Antes de tocar la base, igual que las otras. Es la única respuesta
  // distinta, y es genérica por IP: no dice nada sobre ninguna cuenta.
  if (!(await allowAuthAttempt())) return { error: errors.tooManyAttempts }

  // Con sesión, el correo es el de la sesión y el del formulario se ignora:
  // que nadie use una pantalla autenticada para mandarle correos a otro.
  const session = await getSession()
  const email = session
    ? session.user.email
    : normalizeEmail(formData.get("email"))
  // Un correo inválido tampoco es un error visible: distinguirlo del que no
  // tiene cuenta abriría una diferencia observable, como en `forgotPassword`.
  if (!EMAIL_RE.test(email)) return { sent: true }

  try {
    // El mismo `callbackURL` que el alta: el [Enlace de verificacion] aterriza
    // en `/pending`, que decide por todos (ver `registerAction`).
    await getAuth().api.sendVerificationEmail({
      body: { email, callbackURL: "/pending" },
      // Con `headers` la librería ve la sesión (si la hay) y el idioma del
      // correo sale de la cookie `lang` de esta request
      // (`lib/auth/email-locale.ts`).
      headers: await headers(),
    })
  } catch (error) {
    // Dos `APIError` posibles, y ninguno cambia lo que ve la persona:
    //
    //   - **Sin sesión** la librería no lanza por correo inexistente (responde
    //     lo mismo, con relleno de tiempo), así que lo que llega acá es un
    //     fallo real de envío, y contarlo sería el oráculo.
    //   - **Con sesión** puede lanzar `EMAIL_MISMATCH` (no aplica: el correo
    //     es el de la sesión) o `EMAIL_ALREADY_VERIFIED`, que solo pasa si la
    //     cookie de caché decía «sin confirmar» y la base ya dice lo contrario.
    //     Para esa persona el correo **ya está** confirmado: decirle «listo»
    //     es lo correcto, y la próxima lectura viva de la bandera lo refleja.
    if (!(error instanceof APIError)) throw error
  }

  return { sent: true }
}
