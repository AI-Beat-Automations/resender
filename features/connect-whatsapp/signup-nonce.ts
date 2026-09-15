import { randomBytes, timingSafeEqual } from "crypto"

// El sustituto del `state` de los otros dos canales.
//
// **Por qué hace falta uno propio.** Messenger e Instagram entran por
// redirección: Meta navega a `/api/meta/.../callback` y el CSRF lo cubre una
// cookie de `state` que sembró la ruta `/start`. Embedded Signup no redirige a
// ningún sitio: es un popup que devuelve el `code` por `postMessage` a la
// pestaña que lo abrió. Sin navegación de vuelta no hay callback donde comparar
// el `state`, así que esa protección se reconstruye con un nonce que emite el
// servidor, viaja al launcher y vuelve en el cuerpo del cierre.
//
// **Dónde vive: en una cookie httpOnly, no en una tabla.** Una tabla haría lo
// mismo a cambio de una migración, dos consultas por conexión y filas que hay
// que barrer; un JWT firmado sin estado no se puede consumir de verdad
// —cualquier copia vale hasta que caduca—, y consumirlo es justo lo que se
// pide. La cookie da el uso único gratis: se borra al leerla.
//
// El valor lleva el tenant delante (`${tenantId}.${nonce}`) porque la cookie
// sobrevive a un cambio de sesión en el mismo navegador: sin esa atadura, el
// nonce que emitió una cuenta serviría para cerrar el onboarding de la
// siguiente que iniciara sesión ahí.
//
// El módulo es puro respecto de Next a propósito —recibe el almacén de cookies
// por parámetro— para que la emisión y el consumo se puedan probar sin
// `next/headers` y sin un request: son la mitad de la seguridad de este flujo.
export const SIGNUP_NONCE_COOKIE = "whatsapp_signup_nonce"

// Diez minutos, como el `state` de Instagram. Es lo que tarda alguien en
// completar el Embedded Signup con calma; más allá, lo honesto es volver a
// empezar, porque el `code` que produzca ese flujo vive 30 segundos igual.
export const SIGNUP_NONCE_TTL_SECONDS = 600

export const SIGNUP_NONCE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  // `lax` y no `strict`: la pestaña que abre el popup es la nuestra, así que la
  // petición de cierre es same-site igual, pero `strict` rompería el caso de
  // quien llega a Conexiones desde un enlace externo.
  sameSite: "lax",
  path: "/",
  maxAge: SIGNUP_NONCE_TTL_SECONDS,
} as const

// Lo mínimo que este módulo usa de un almacén de cookies. Encajan el de
// `next/headers` y el de una `NextResponse`, y también un objeto de tres
// líneas en un test.
export type SignupNonceCookieStore = {
  get(name: string): { value: string } | undefined
  set(
    name: string,
    value: string,
    options: typeof SIGNUP_NONCE_COOKIE_OPTIONS
  ): unknown
  delete(name: string): unknown
}

// 32 bytes del CSPRNG: es un secreto de sesión, no un identificador.
export function generateSignupNonce(): string {
  return randomBytes(32).toString("base64url")
}

export function bindNonceToTenant(tenantId: string, nonce: string): string {
  return `${tenantId}.${nonce}`
}

// Emite el nonce y lo siembra. Devuelve el valor **sin** el tenant delante: lo
// que el launcher necesita reenviar es el secreto, y mandarle el par completo
// solo publicaría el id del tenant en el DOM sin ganar nada.
export function issueSignupNonce(
  store: SignupNonceCookieStore,
  tenantId: string
): string {
  const nonce = generateSignupNonce()
  store.set(
    SIGNUP_NONCE_COOKIE,
    bindNonceToTenant(tenantId, nonce),
    SIGNUP_NONCE_COOKIE_OPTIONS
  )
  return nonce
}

// Verifica y **consume** el nonce. Se borra la cookie pase lo que pase y antes
// de comparar: si solo se borrara cuando coincide, un atacante tendría intentos
// ilimitados contra la misma cookie, que es exactamente lo que «un solo uso»
// evita. El precio es que un launcher con un bug quema el nonce y obliga a
// pedir otro, que es el lado correcto en el que equivocarse.
export function consumeSignupNonce(
  store: SignupNonceCookieStore,
  tenantId: string,
  submitted: string | null
): boolean {
  const cookie = store.get(SIGNUP_NONCE_COOKIE)?.value ?? null
  store.delete(SIGNUP_NONCE_COOKIE)

  if (!cookie || !submitted) return false
  return constantTimeEquals(cookie, bindNonceToTenant(tenantId, submitted))
}

// Comparación en tiempo constante. El `===` del `state` de Instagram alcanza
// para un valor que viaja en una URL, pero este nonce se compara contra un
// secreto de 256 bits que el atacante puede sondear a voluntad desde una
// pestaña con sesión: la diferencia de coste es un `Buffer` y no tener que
// razonar sobre si el oráculo es explotable.
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  // `timingSafeEqual` lanza si las longitudes difieren, y la longitud no es
  // secreta: el nonce mide siempre lo mismo.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
