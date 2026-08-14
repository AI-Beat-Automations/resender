import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

import type { Sql } from "@/lib/db"

// Postgres de verdad —el mismo motor, compilado a WASM— para los tests que
// tienen que **ejecutar** SQL en vez de leerlo.
//
// El resto de los tests de esta app le pone a `getSql` un tag de mentira que
// anota la consulta y devuelve lo que la prueba encoló. Eso fija el
// comportamiento (qué se filtra, cómo se traduce un 23505) pero no puede fallar
// por nada que decida Postgres: ni un bind cuyo tipo no sabe inferir —el 500 de
// la ingesta de WhatsApp fue exactamente eso—, ni un check, ni un unique, ni una
// columna que no existe. Este helper cubre esa mitad.
//
// Se duplica a propósito el arranque que `apps/api` tiene en
// `test/postgres/database.ts`: las dos apps no comparten código de runtime (es
// la convención del repo, la misma por la que `META_GRAPH_VERSION` está escrita
// dos veces), y un paquete nuevo para cuarenta líneas de bootstrap costaría más
// de lo que resuelve.

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/migrations"
)

export type TestDatabase = {
  db: PGlite
  // Con la firma exacta de `Sql` (el tag de Neon) que devuelve `getSql`, para
  // poder sustituirlo sin tocar los call sites.
  sql: Sql
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  // `pgcrypto` cargado a mano: la 0001 hace `create extension pgcrypto` para
  // `gen_random_uuid()`, y PGlite solo trae las extensiones que se le declaran.
  const db = await PGlite.create({ extensions: { pgcrypto } })
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    // `exec` (protocolo simple, multi-sentencia) es lo que hace el runner real
    // en `scripts/migrate.mjs` vía `tx.unsafe`.
    await db.exec(await readFile(path.join(migrationsDirectory, file), "utf8"))
  }
  return { db, sql: pgliteSql(db), close: () => db.close() }
}

// El tag de Neon, reimplementado contra PGlite.
//
// Fidelidad al transporte real, que es lo único que importa acá: el driver HTTP
// de Neon manda la sentencia con `$1..$N` y los binds **sin declarar tipos**, y
// deja que el servidor los infiera. PGlite hace lo mismo (`Parse` sin
// `paramTypes` y luego `Describe` para leer lo que el servidor dedujo), así que
// un bind que Neon no puede tipar tampoco se tipa acá. Si este helper declarara
// tipos, la clase de bug que existe para cazar dejaría de reproducirse.
function pgliteSql(db: PGlite): Sql {
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const result = await db.query<Record<string, unknown>>(
      toPlaceholders(strings),
      values
    )
    return result.rows
  }
  return Object.assign(tagged, {
    transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
  }) as unknown as Sql
}

// `strings[0] + "$1" + strings[1] + "$2" + ...`: la numeración que produce el
// tag es la del SQL final, contando **todas** las interpolaciones desde el
// principio de la sentencia. Es la misma cuenta que hay que hacer a mano para
// localizar el `$N` de un mensaje de error.
function toPlaceholders(strings: TemplateStringsArray): string {
  return strings.reduce(
    (statement, chunk, index) =>
      index === 0 ? chunk : `${statement}$${index}${chunk}`,
    ""
  )
}
