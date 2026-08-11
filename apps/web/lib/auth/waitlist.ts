import { getSql } from "@/lib/db"

// Access gate for the waitlist launch: a user only reaches the product once
// `users.waitlisted` is explicitly false. New signups default to true, so the
// product stays closed until someone flips the flag for that account.
export type WaitlistAccessRow = { waitlisted: boolean }

type MaybeRow = WaitlistAccessRow | null | undefined

// Las tres respuestas no son dos: "no entra" agrupaba dos situaciones que se
// arreglan de forma opuesta. `waitlisted` es una decisión sobre una cuenta que
// existe; `unknown_user` es una sesión firmada que apunta a un usuario que no
// está en la base —cookie vieja tras cambiar de `DATABASE_URL`, o cuenta
// borrada con la sesión todavía viva— y de eso solo se sale volviendo a
// autenticarse. Tratarlas igual producía un rebote infinito: el gate mandaba a
// una pantalla que, al ver la sesión firmada, devolvía al producto.
export type ProductAccess = "allowed" | "waitlisted" | "unknown_user"

// Fail closed: a missing row (deleted account with a still-valid session) or an
// unreadable flag is treated as "no access", never as an open door.
export function hasProductAccess(row: MaybeRow): boolean {
  return row?.waitlisted === false
}

export function decideProductAccess(row: MaybeRow): ProductAccess {
  if (!row) return "unknown_user"
  return hasProductAccess(row) ? "allowed" : "waitlisted"
}

// Read live from the database instead of the JWT, so removing someone from the
// waitlist takes effect on their next request without forcing a re-login.
async function readAccessRow(userId: string): Promise<MaybeRow> {
  const sql = getSql()
  const [row] = await sql<WaitlistAccessRow[]>`
    select waitlisted
    from users
    where id = ${userId}
    limit 1
  `

  return row
}

export async function resolveProductAccess(
  userId: string
): Promise<ProductAccess> {
  return decideProductAccess(await readAccessRow(userId))
}

// Se mantiene para el hot path de `POST /api/meta/send`, donde la distinción no
// cambia la respuesta: sin acceso es 403 venga de donde venga.
export async function isUserWaitlisted(userId: string): Promise<boolean> {
  return !hasProductAccess(await readAccessRow(userId))
}
