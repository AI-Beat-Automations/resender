import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

import type { Sql } from "../../src/infrastructure/db/client"

// Postgres de verdad —el mismo motor, compilado a WASM— para los tests que
// tienen que **ejecutar** el SQL del repositorio en vez de leerlo.
//
// **Por qué existe este archivo.** Los tests de `repository.test.ts` corren
// contra `fakeSql`/`capturingSql`: capturan el texto de la sentencia y sus
// binds y afirman sobre esas cadenas. Un doble no puede fallar por inferencia
// de tipos, y por eso una sentencia con un bind que Postgres no sabe tipar
// —`could not determine data type of parameter $N`, que revienta al preparar,
// antes de ejecutar nada— pasa la suite entera en verde y muere en el primer
// webhook real. PGlite cierra justamente ese hueco: prepara y ejecuta.
//
// Las migraciones viven en `apps/web/db/migrations` (el Worker `api` no tiene
// las suyas: comparte la base con la consola), así que este helper cruza a la
// otra app para leerlas. Es la única dependencia entre ambas y es de datos, no
// de código.

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../web/db/migrations"
)

export type TestDatabase = {
  db: PGlite
  // El cliente con la forma exacta de `Sql` (el tag de Neon) que espera
  // `SqlRepository`, para poder construir el repositorio real.
  sql: Sql
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  // `pgcrypto` como extensión cargada a mano: la 0001 hace
  // `create extension pgcrypto` para `gen_random_uuid()`, y PGlite solo trae
  // las extensiones que se le declaran al construirlo.
  const db = await PGlite.create({ extensions: { pgcrypto } })
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    const migration = await readFile(path.join(migrationsDirectory, file), "utf8")
    // `exec` (protocolo simple, multi-sentencia) es lo que usa el runner real
    // en `apps/web/scripts/migrate.mjs` vía `tx.unsafe`.
    await db.exec(migration)
  }
  return {
    db,
    sql: pgliteSql(db),
    close: () => db.close(),
  }
}

// El tag de Neon, reimplementado contra PGlite.
//
// Fidelidad al transporte real, que es lo único que importa acá: el driver HTTP
// de Neon manda la sentencia con `$1..$N` y los binds **sin declarar tipos**, y
// deja que el servidor los infiera. PGlite hace exactamente lo mismo
// (`Parse` sin `paramTypes`, y luego `Describe` para saber qué dedujo el
// servidor), así que un bind que Neon no puede tipar tampoco se tipa acá. Si
// este helper declarara tipos, el bug que existe para cazar dejaría de
// reproducirse.
export function pgliteSql(db: PGlite): Sql {
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const rows = await db.query<Record<string, unknown>>(
      toPlaceholders(strings),
      values as unknown[]
    )
    return rows.rows
  }
  return Object.assign(tagged, {
    // El otro transporte del repositorio: las lecturas con filtros dinámicos,
    // que ya construyen su propio `$n`.
    query: async (text: string, parameters: unknown[] = []) => {
      const rows = await db.query<Record<string, unknown>>(text, parameters)
      return rows.rows
    },
    transaction: async (queries: unknown[]) => queries,
  }) as unknown as Sql
}

// `strings[0] + "$1" + strings[1] + "$2" + ...`: la numeración que produce el
// tag es la del SQL final, contando **todas** las interpolaciones desde el
// principio de la sentencia (las de los CTE incluidas). Es la misma cuenta que
// hay que hacer a mano para localizar un `$N` en un mensaje de error.
function toPlaceholders(strings: TemplateStringsArray): string {
  return strings.reduce(
    (statement, chunk, index) =>
      index === 0 ? chunk : `${statement}$${index}${chunk}`,
    ""
  )
}
