// Traducción del `?error=` con el que Better Auth rebota al `errorCallbackURL`
// del flujo de OAuth (issue #98). Es un módulo `.ts` propio porque es la regla
// testeable: los `.tsx` no corren en vitest.
//
// La librería tiene trece códigos en `better-auth/dist/oauth2/errors.mjs`
// más `account_not_linked`, que `link-account.mjs` emite aparte (el callback
// pasa «account not linked» a snake_case). **Solo `account_not_linked` tiene
// mensaje y salida propios** —con el botón de reenviar la confirmación—; los
// otros trece y cualquier código desconocido caen en un genérico. No se abre
// una ruta `/auth/error`: el mensaje se dibuja en el cuadro `role="alert"`
// que `auth-form` ya tiene.

export type OAuthErrorKind = "account_not_linked" | "generic"

// El único código con salida propia. Sale de `oauth2/link-account.mjs` cuando
// la cuenta local existe y su correo **no está confirmado**
// (`accountLinking.requireLocalEmailVerified`, que vale `true` por defecto y
// que `trustedProviders` no saltea).
//
// Caso raro, escrito a sabiendas: si Google reporta `email_verified=false` en
// un perfil raro, el rebote es **también** `account_not_linked`, y «confirma
// tu correo» sería engañoso. No se distingue porque la librería no lo
// distingue; y con `sendOnSignUp: true` un alta por Google con correo no
// verificado sí recibe el correo de confirmación, así que el botón de reenviar
// sigue siendo la salida correcta.
const ACCOUNT_NOT_LINKED = "account_not_linked"

function normalize(code: string | string[] | undefined | null): string {
  // `searchParams` de Next entrega `string | string[]`: con dos `?error=` se
  // toma el primero, que es el que puso la librería.
  const raw = Array.isArray(code) ? code[0] : code
  return (raw ?? "").trim().toLowerCase()
}

/**
 * `null` sin código: la pantalla no muestra nada. `"account_not_linked"` para
 * ese código; `"generic"` para cualquier otro no vacío, conocido o no.
 */
export function classifyOAuthError(
  code: string | string[] | undefined | null
): OAuthErrorKind | null {
  const normalized = normalize(code)
  if (normalized === "") return null
  return normalized === ACCOUNT_NOT_LINKED ? ACCOUNT_NOT_LINKED : "generic"
}

// El `?error=` que `GET /api/auth/verify-email` agrega al `callbackURL`
// (`/pending`) cuando el [Enlace de verificacion] no sirve. En 1.7.2 el valor
// es `error.code` de `BASE_ERROR_CODES`, que es la **clave en mayúsculas**
// (`TOKEN_EXPIRED`, `INVALID_TOKEN`; ver
// `better-auth/dist/api/routes/email-verification.mjs`, `redirectOnError`).
// Se acepta también en minúsculas por si un bump lo cambia de caso: la
// diferencia entre «venció» y «no es válido» no le sirve a la persona —en los
// dos casos pide uno nuevo—, así que colapsan en un solo estado.
export type VerificationErrorKind = "link_expired"

const VERIFICATION_LINK_ERRORS = new Set(["token_expired", "invalid_token"])

/**
 * `"link_expired"` si el enlace de verificación venció o no es válido;
 * `null` para cualquier otro valor, incluido ausente. Un código que no sea de
 * estos dos —`USER_NOT_FOUND`, `INVALID_USER`— se ignora: `/pending` no tiene
 * nada útil que decir sobre ellos y mostrar «venció» sería mentir.
 */
export function classifyVerificationError(
  code: string | string[] | undefined | null
): VerificationErrorKind | null {
  return VERIFICATION_LINK_ERRORS.has(normalize(code)) ? "link_expired" : null
}
