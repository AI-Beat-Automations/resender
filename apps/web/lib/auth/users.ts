import { getSql } from "@/lib/db"

// Lectura del modelo de usuario contra la base. **Ya no escribe nada**: desde
// el cutover a Better Auth (ADR 0014) el alta, el acceso y el cambio de
// contraseña los hace la librería, y la contraseña vive hasheada en la
// [Credencial] (`auth_accounts`), no en `users`.
//
// Lo que se fue de acá y por qué:
//   - `authenticateUser`: lo reemplaza `auth.api.signInEmail`.
//   - `changeUserPassword`: lo reemplaza `lib/auth/set-password.ts`.
//   - `createUser` y `DuplicateEmailError`: los reemplaza
//     `auth.api.signUpEmail`. Además `createUser` insertaba `password_hash`,
//     que la migración `0021` dropea, así que no podía sobrevivir al deploy.
//   - `InvalidAuthInputError`: solo lo lanzaban las tres funciones de arriba.
//     Los códigos de `lib/auth/validation` siguen existiendo; ahora los leen
//     directamente los server actions.

export type UserRecord = {
  id: string
  email: string
  name: string
  waitlisted: boolean
  createdAt: Date
}

type UserRow = {
  id: string
  email: string
  name: string
  waitlisted: boolean
  created_at: Date
}

export async function getUserByEmail(emailInput: unknown) {
  const email =
    typeof emailInput === "string" ? emailInput.trim().toLowerCase() : ""
  if (!email) return null

  const sql = getSql()
  const [row] = await sql<UserRow[]>`
    select id, email, name, waitlisted, created_at
    from users
    where email = ${email}
    limit 1
  `

  return row ? mapUser(row) : null
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    waitlisted: row.waitlisted,
    createdAt: row.created_at,
  }
}
