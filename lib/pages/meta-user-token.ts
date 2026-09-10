import { describeError, log } from "@/lib/observability/logger"
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"

// User access token de larga duración de Meta, uno por tenant (ADR 0004). Da
// acceso a **todas** las páginas que el usuario administra, no solo a las
// conectadas, así que se guarda cifrado con el mismo módulo que protege los
// page tokens y nunca sale del servidor.

export async function saveMetaUserAccessToken(
  tenantId: string,
  token: string
): Promise<void> {
  const sql = getSql()
  await sql`
    update users
    set meta_user_access_token_encrypted = ${encryptSecret(token)},
        meta_user_access_token_updated_at = now(),
        updated_at = now()
    where id = ${tenantId}
  `
}

export async function getMetaUserAccessToken(
  tenantId: string
): Promise<string | null> {
  const sql = getSql()
  const [row] = await sql<
    { meta_user_access_token_encrypted: string | null }[]
  >`
    select meta_user_access_token_encrypted
    from users
    where id = ${tenantId}
    limit 1
  `

  if (!row?.meta_user_access_token_encrypted) return null

  try {
    return decryptSecret(row.meta_user_access_token_encrypted)
  } catch (error) {
    // Credencial ilegible (clave rotada, payload corrupto): devolvemos null
    // para mandar al usuario de vuelta al diálogo de Meta, no un 500.
    log({
      entrypoint: "route",
      action: "token_decrypt",
      outcome: "failed",
      reason: "configuration_failed",
      tenantId,
      errorMessage: describeError(error),
    })
    return null
  }
}
