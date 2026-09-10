// Google como proveedor social (issue #98). Es el primer proveedor que se
// enciende desde que la ADR 0014 dejó `socialProviders: {}` con una
// precondición bloqueante —verificación de correo en el alta— que esa misma
// entrega cumplió.
//
// Vive en su propio módulo `.ts` y no inline en `auth.ts` por dos razones:
// las pantallas de acceso consultan `isGoogleEnabled()` para dibujar o no el
// botón —que la UI no adivine leyendo `process.env`—, y la regla «solo con las
// dos variables» es testeable sin levantar Better Auth.

export type GoogleProviderConfig = {
  clientId: string
  clientSecret: string
}

function readCredentials(): GoogleProviderConfig | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return undefined
  return { clientId, clientSecret }
}

/**
 * Verdadero solo si `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` están las dos
 * y no vacías. Con una sola, Google no existe: registrar un proveedor a medias
 * dibujaría un botón que revienta en el callback.
 */
export function isGoogleEnabled(): boolean {
  return readCredentials() !== undefined
}

/**
 * La configuración que se le pasa a `socialProviders.google`, o `undefined`
 * cuando falta alguna credencial.
 *
 * **Sin scopes extra, y eso es una decisión.** Quedan los tres por defecto de
 * la librería (`openid`, `email`, `profile`): son scopes no sensibles y por eso
 * la app no necesita pasar la revisión de Google. Pedir uno más —calendario,
 * contactos— obligaría a la revisión y no hay ninguna feature que lo use.
 */
export function googleProvider(): GoogleProviderConfig | undefined {
  return readCredentials()
}

/**
 * El objeto entero de `socialProviders`: vacío sin credenciales, exactamente
 * como estaba antes del #98, para que `next build`, vitest y cualquier entorno
 * sin secretos sigan funcionando. Es la misma lógica perezosa que protege
 * `getAuth()`: se lee en la primera request, no en build.
 */
export function socialProviders(): { google?: GoogleProviderConfig } {
  const google = googleProvider()
  return google ? { google } : {}
}
