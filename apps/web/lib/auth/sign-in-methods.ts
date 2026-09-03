import { headers } from "next/headers"

import { getAuth } from "@/lib/auth/auth"

// Las [Credencial]es de la cuenta con sesión abierta, resumidas para el panel
// «Cómo entras a Resender» de Settings ([Cuenta vinculada], issue #98).
//
// Igual que `lib/auth/api-keys.ts` con el plugin: **el único lugar que le habla
// a `listUserAccounts`**. La pantalla y las server actions importan de acá, y
// este archivo es el punto de mockeo de los tests. La regla en sí —qué se
// ofrece y qué no— es `summarizeAccounts`, pura y testeable sin Better Auth.

/** Lo que devuelve `listUserAccounts`, reducido a lo que la regla necesita. */
export type SignInAccount = {
  /** Id de la fila de `auth_accounts`. Es lo que `unlinkAccount` pide. */
  id: string
  providerId: string
}

export type SignInMethods = {
  /** Hay fila del proveedor `credential`: la contraseña sirve para entrar. */
  password: boolean
  google: {
    linked: boolean
    /**
     * Id de la **fila** de `auth_accounts`, que es lo que `unlinkAccount`
     * espera en `accountId`. No confundir con el `accountId` que devuelve
     * `listUserAccounts`, que es el `sub` de Google (un número), no el email.
     */
    accountId?: string
  }
  /**
   * Si se ofrece «Desvincular». La librería se niega a quitar la última
   * credencial (`FAILED_TO_UNLINK_LAST_ACCOUNT`), así que el botón no se
   * dibuja cuando Google es la única: una cuenta sin credenciales no podría
   * volver a entrar.
   */
  canRemoveGoogle: boolean
  total: number
}

/**
 * La regla del panel. Pura: recibe las filas y decide qué hay y qué se puede
 * quitar. `listUserAccounts` no trae el email de Google —solo el `sub`—, y no
 * hace falta: vincular exige que coincida con el de la cuenta, así que «la
 * dirección de Google» que muestra el panel es el email de la cuenta.
 */
export function summarizeAccounts(accounts: SignInAccount[]): SignInMethods {
  const password = accounts.some((a) => a.providerId === "credential")
  const google = accounts.find((a) => a.providerId === "google")

  return {
    password,
    google: google ? { linked: true, accountId: google.id } : { linked: false },
    // Se puede quitar solo si queda otra credencial después. Hoy «otra» es la
    // contraseña; con más proveedores la cuenta sigue valiendo sola.
    canRemoveGoogle: Boolean(google) && accounts.length > 1,
    total: accounts.length,
  }
}

/**
 * Las credenciales de la sesión abierta. El endpoint resuelve el dueño
 * **desde la cookie**, no de un parámetro: no hay forma de pedir las de otra
 * cuenta, que es el mismo aislamiento que da `listApiKeys`.
 */
export async function listSignInMethods(): Promise<SignInMethods> {
  const accounts = await getAuth().api.listUserAccounts({
    headers: await headers(),
  })

  return summarizeAccounts(
    accounts.map((a) => ({ id: a.id, providerId: a.providerId }))
  )
}

// --- Desvincular: los códigos de la librería, traducidos a los nuestros ---

/**
 * Por qué no se pudo desvincular. Código y no mensaje: el texto lo pone
 * Settings, que es quien sabe el idioma (mismo criterio que `ApiKeyLabelError`).
 */
export type UnlinkError =
  | "last_credential"
  | "session_not_fresh"
  | "account_not_found"
  | "unknown"

// Los tres códigos que `unlinkAccount` puede lanzar en 1.7.2
// (`api/routes/account.mjs` y `freshSessionMiddleware`). Cualquier otro es
// `unknown` y cae en el genérico: no se le miente a la persona con un motivo
// que la librería no dio.
const UNLINK_ERRORS: Record<string, Exclude<UnlinkError, "unknown">> = {
  FAILED_TO_UNLINK_LAST_ACCOUNT: "last_credential",
  SESSION_NOT_FRESH: "session_not_fresh",
  ACCOUNT_NOT_FOUND: "account_not_found",
}

export function classifyUnlinkError(code: unknown): UnlinkError {
  return (typeof code === "string" && UNLINK_ERRORS[code]) || "unknown"
}
