import { getSql } from "@/lib/db"

// Lectura de cortesía sobre el [Enlace de recuperacion], para poder mostrar
// "el enlace ya no sirve" **antes** del formulario en vez de después de que la
// persona pensó y tipeó dos contraseñas.
//
// **No consume nada.** `auth.api.resetPassword` sigue siendo la única autoridad
// sobre el token: esto es UI y el TOCTOU entre el peek y el submit es benigno
// —lo peor que pasa es que el formulario se envíe y la acción devuelva
// `resetLinkExpired`, que es exactamente lo que pasaba sin peek—.
//
// **Cablea dos detalles internos de Better Auth**: que la fila de
// `auth_verifications` use el identifier `reset-password:<token>` y que su
// `value` sea el `users.id`. Eso es deuda consciente, y la red que la atrapa es
// el test de contrato de `password-reset.test.ts` contra una instancia real de
// la librería —no la revisión humana—. Si la librería cambia el formato, el
// peek mentiría en silencio: diría "vencido" sobre un token bueno.
const RESET_IDENTIFIER_PREFIX = "reset-password:"

export function resetTokenIdentifier(token: string): string {
  return `${RESET_IDENTIFIER_PREFIX}${token}`
}

/** `true` si el token existe y todavía no venció. */
export async function peekResetToken(token: string): Promise<boolean> {
  if (!token) return false

  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    select id
    from auth_verifications
    where identifier = ${resetTokenIdentifier(token)}
      and expires_at > now()
    limit 1
  `
  return rows.length > 0
}
