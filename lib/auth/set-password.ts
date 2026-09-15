import { getAuth } from "@/lib/auth/auth"

// Cambiar la contraseña **sin pedir la anterior**, que es la regla que el
// producto ya tenía (CONTEXT.md → [Usuario MVP]) y que la ADR 0014 conserva a
// sabiendas.
//
// Lo que se probó contra `better-auth@1.7.2` y por qué no sirve:
//
//   - `auth.api.changePassword` **exige** `currentPassword`. Es justo la regla
//     que el producto no tiene.
//   - `auth.api.setPassword` **solo crea**: si la credencial ya tiene password
//     tira `APIError(BAD_REQUEST, PASSWORD_ALREADY_SET)`. Sirve para la cuenta
//     que entró por un proveedor social y todavía no tiene contraseña, no para
//     reemplazar una.
//   - Hashear a mano con criptografía propia es exactamente lo que la ADR 0014
//     vino a borrar.
//
// Queda la vía que `resetPassword` usa por dentro: el hash lo produce
// `ctx.password.hash` —el scrypt de la librería, sin criptografía nueva— y la
// escritura la hace `ctx.internalAdapter`.
//
// **`internalAdapter` es API interna y su superficie cambió entre minors.** Por
// eso está encerrada en este único archivo: un bump de versión de
// `better-auth` se arregla acá y en ningún otro lado. `set-password.test.ts`
// corre estas mismas llamadas contra una instancia real y falla si la forma
// cambia.

/** El pedazo del contexto de Better Auth del que depende este módulo. */
type PasswordContext = {
  password: { hash: (password: string) => Promise<string> }
  internalAdapter: {
    findCredentialAccount: (userId: string) => Promise<unknown>
    updatePassword: (userId: string, password: string) => Promise<unknown>
    createAccount: (account: {
      userId: string
      providerId: string
      issuer: string
      accountId: string
      password: string
    }) => Promise<unknown>
  }
}

// Los cuatro valores que tienen que salir bien o el login no encuentra la
// credencial: `sign-in/email`, `updatePassword` y `findCredentialAccount`
// filtran por `provider_id`, `issuer`, `account_id = users.id` y
// `user_id = users.id`. `'local:credential'` es lo que produce
// `createLocalAccountIssuer("credential")` dentro de la librería.
const CREDENTIAL_PROVIDER_ID = "credential"
const CREDENTIAL_ISSUER = "local:credential"

/**
 * Escribe la contraseña de la credencial local del usuario, creándola si no
 * existe. Recibe el contexto para que el test pueda pasarle uno real sin base
 * de datos de producción.
 */
export async function applyPasswordToCredential(
  ctx: PasswordContext,
  userId: string,
  newPassword: string
): Promise<void> {
  const hash = await ctx.password.hash(newPassword)

  // `updatePassword` filtra por los cuatro campos de arriba y, si no hay fila,
  // **no crea nada y tampoco falla**: sin esta comprobación previa el cambio de
  // contraseña sería un no-op silencioso para una cuenta sin credencial.
  const existing = await ctx.internalAdapter.findCredentialAccount(userId)

  if (existing) {
    // Recibe el **hash**, no el texto plano.
    await ctx.internalAdapter.updatePassword(userId, hash)
    return
  }

  await ctx.internalAdapter.createAccount({
    userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    issuer: CREDENTIAL_ISSUER,
    accountId: userId,
    password: hash,
  })
}

/** Lo que consume el producto (`features/account/actions.ts`). */
export async function setUserPassword(
  userId: string,
  newPassword: string
): Promise<void> {
  const ctx = (await getAuth().$context) as unknown as PasswordContext
  await applyPasswordToCredential(ctx, userId, newPassword)
}
