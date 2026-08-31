import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { hashPassword } from "better-auth/crypto"
import postgres from "postgres"

import { loadEnvFile } from "./load-env.mjs"

// Script de UNA SOLA VEZ, para correr **después** de desplegar el cutover a
// Better Auth (ADR 0014, escalón 2). Sin él nadie puede entrar: la migración
// `0021` dropea `users.password_hash` y los hashes viejos no son migrables
// —formato `scrypt$<salt b64url>$<key b64url>` con `r=8` contra
// `<salt hex>:<key hex>` con `r=16`—, así que cada cuenta existente necesita
// una [Credencial] nueva.
//
// ============================================================================
// LO QUE ESTE SCRIPT NO HACE NUNCA: BORRAR FILAS DE `users`.
//
// `0002_account_deletion_cascade.sql` puso todo el esquema en `on delete
// cascade` contra `users.id`. Un `delete from users` acá se llevaría, sin aviso
// y sin vuelta atrás, las `connected_pages` del tenant, sus `conversations`,
// sus `messages`, sus `api_keys` y su `subscriptions`. El uuid **se conserva
// siempre**: es el tenant, y 13 foreign keys cuelgan de él. Este script solo
// hace INSERT en `auth_accounts` y UPDATE del `name` de `users`.
// ============================================================================
//
// Las contraseñas entran por variable de entorno, **nunca escritas en este
// archivo**, con una variable por cuenta:
//
//   SEED_CREDENTIAL_1="alguien@ejemplo.com:contraseñaNueva:Nombre Apellido" \
//   SEED_CREDENTIAL_2="otro@ejemplo.com:otraContraseña:Otro Nombre" \
//     node scripts/seed-credentials.mjs
//
// El nombre es opcional (tercer campo): si no viene, el `name` de esa cuenta
// queda como está. La contraseña no puede contener `:`.
//
// Es idempotente: si la cuenta ya tiene credencial, la reescribe en vez de
// insertar una segunda —`(issuer, account_id)` es unique—.
//
// Se borra en un PR posterior, cuando ya no quede ninguna cuenta sin credencial.

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
await loadEnvFile(path.join(appDir, ".env"))

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is required")
  process.exit(1)
}

// Los cuatro valores que tienen que salir bien o `sign-in/email` no encuentra
// la credencial: filtra por `provider_id = 'credential'`,
// `issuer = 'local:credential'`, `account_id = users.id` y `user_id = users.id`.
const PROVIDER_ID = "credential"
const ISSUER = "local:credential"

const entries = Object.entries(process.env)
  .filter(([key]) => key.startsWith("SEED_CREDENTIAL_"))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, raw]) => {
    const [email, password, ...nameParts] = String(raw).split(":")
    if (!email || !password) {
      console.error(`${key}: se espera "email:contraseña[:nombre]"`)
      process.exit(1)
    }
    return {
      email: email.trim().toLowerCase(),
      password,
      name: nameParts.join(":").trim(),
    }
  })

if (entries.length === 0) {
  console.error(
    "No hay ninguna variable SEED_CREDENTIAL_*. Nada que sembrar; ver el encabezado de este archivo."
  )
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1 })

try {
  for (const entry of entries) {
    const [user] = await sql`
      select id, name from users where email = ${entry.email} limit 1
    `

    if (!user) {
      // No se crea la cuenta: este script existe para las que ya operan. Crear
      // una acá inventaría un tenant sin suscripción ni conexiones.
      console.error(`sin cuenta para ${entry.email}: se saltea`)
      continue
    }

    // El hash lo produce la librería (`better-auth/crypto`), no criptografía
    // propia: tiene que salir en el formato exacto que `verifyPassword` espera.
    const password = await hashPassword(entry.password)

    // `id` es `text` sin default en `auth_accounts` (migración 0020), así que
    // lo pone el script. `user_id` y `account_id` son el uuid del tenant, que
    // **no cambia**.
    await sql`
      insert into auth_accounts (
        id, user_id, account_id, issuer, provider_id, password
      )
      values (
        ${randomUUID()}, ${user.id}, ${user.id}, ${ISSUER}, ${PROVIDER_ID},
        ${password}
      )
      on conflict (issuer, account_id)
      do update set password = excluded.password, updated_at = now()
    `

    if (entry.name) {
      await sql`
        update users set name = ${entry.name}, updated_at = now()
        where id = ${user.id}
      `
    }

    console.log(
      `credencial lista para ${entry.email} (${user.id})${
        entry.name ? ` — name: ${entry.name}` : ""
      }`
    )
  }
} finally {
  await sql.end()
}
