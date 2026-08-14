import { getSql } from "@/lib/db"

// Permiso por cuenta para el canal Instagram (ADR 0010). Instagram está
// implementado pero Meta todavía no concedió el Advanced Access, así que el
// canal solo se abre para las cuentas que se aprueban a mano:
//   update users set instagram_enabled = true where email = '...';
//
// Vive en su propio módulo y no en `lib/auth/waitlist.ts` a propósito: ese
// archivo está marcado para borrarse en cuanto se limpie el gate apagado de la
// 0011, y sumarle código nuevo lo volvería inmortal.
export type ChannelAccessRow = { instagram_enabled: boolean }

type MaybeRow = ChannelAccessRow | null | undefined

// Fail closed: una fila ausente —cuenta borrada con la sesión todavía viva— o
// una bandera ilegible se tratan como "sin acceso", nunca como puerta abierta.
// Es lo contrario del gate de la 0004, donde el `true` era el bloqueo: acá el
// `true` es el permiso, así que el default de la columna ya es el cierre.
export function hasInstagramAccess(row: MaybeRow): boolean {
  return row?.instagram_enabled === true
}

// Lectura viva contra la base y nunca desde el JWT, por la misma razón que
// `readAccessRow`: dar o quitar el permiso tiene que valer en el request
// siguiente sin obligar a nadie a volver a autenticarse.
async function readChannelAccessRow(userId: string): Promise<MaybeRow> {
  const sql = getSql()
  const [row] = await sql<ChannelAccessRow[]>`
    select instagram_enabled
    from users
    where id = ${userId}
    limit 1
  `

  return row
}

export async function resolveInstagramAccess(userId: string): Promise<boolean> {
  return hasInstagramAccess(await readChannelAccessRow(userId))
}
