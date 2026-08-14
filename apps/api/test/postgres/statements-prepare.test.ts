import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createTestDatabase, type TestDatabase } from "./database"

// **La red que hubiera cazado el 500 de WhatsApp el día que se escribió.**
//
// Postgres tipa los parámetros al *preparar* la consulta, antes de ejecutar
// nada. Si no puede deducir el tipo de uno, la sentencia entera muere con
// "could not determine data type of parameter $N" sin tocar una sola fila: no
// falla el caso raro, falla el endpoint completo desde el primer request. Es lo
// que le pasó a la ingesta de WhatsApp, y es justo lo que ningún doble de `sql`
// puede detectar, porque un doble no infiere tipos.
//
// Este test le pide a Postgres que **prepare todas** las sentencias de los dos
// árboles que escriben SQL a mano, sin ejecutarlas y sin datos: `Parse` +
// `Describe` es exactamente el paso donde vive este bug. Contra el árbol
// anterior al arreglo cazaba los tres sobres rotos a la vez: Messenger ($16),
// comentarios de Instagram ($15) y WhatsApp ($29).
//
// Cómo obtiene las sentencias: leyendo el código fuente y recortando cada
// template etiquetado, con cada `${...}` sustituido por su `$n`. Es la única
// forma de cubrir las 121 que hay hoy sin escribir 121 llamadas con datos de
// mentira (53 en `apps/api` y 68 en `apps/web`), y
// prueba el texto que de verdad viaja (no una copia a mano que se desactualiza).
// Sus límites, que son reales:
//
//   - no ejecuta: un check violado, un `on conflict` mal apuntado o un bind con
//     el valor equivocado no salen acá. Para eso están los tests de
//     comportamiento (`whatsapp-ingest.test.ts`);
//   - no cubre el otro transporte, `sql.query(text, params)`, que arma los
//     filtros dinámicos de los listados: ésos ya escriben sus `$n` a mano;
//   - si algún día un template interpola **SQL** (un fragmento, no un bind), el
//     recorte producirá una sentencia inválida y este test fallará pidiendo que
//     ese fragmento salga del template.

const here = path.dirname(fileURLToPath(import.meta.url))

// El mínimo de sentencias existe para que un extractor roto —cero coincidencias
// tras renombrar el tag, por ejemplo— no pase en verde fingiendo cobertura.
const sources: Array<{ label: string; directory: string; atLeast: number }> = [
  {
    label: "apps/api",
    directory: path.resolve(here, "../../src"),
    atLeast: 50,
  },
  {
    // Cruza a la otra app a propósito: `apps/web` comparte esta misma base de
    // datos y escribe su propio SQL (todo el onboarding de WhatsApp vive ahí).
    // El sweep vive acá y no allá porque acá ya están PGlite y el runner de
    // migraciones; montarlos otra vez en `apps/web` sería mantener dos arranques
    // del mismo Postgres.
    label: "apps/web",
    directory: path.resolve(here, "../../../web/lib"),
    atLeast: 50,
  },
]

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database?.close()
})

describe("toda sentencia etiquetada prepara en Postgres", () => {
  for (const source of sources) {
    it(source.label, async () => {
      const statements = await collectStatements(source.directory)
      expect(statements.length).toBeGreaterThanOrEqual(source.atLeast)

      const failures: string[] = []
      for (const statement of statements) {
        const error = await prepareError(statement)
        if (error) failures.push(`${headline(statement)}\n    ${error}`)
      }
      expect(failures).toEqual([])
    })
  }

  // Canario. Sin él, un extractor que dejara de encontrar los binds —o un
  // Postgres que algún día los infiriera— dejaría este archivo en verde para
  // siempre sin proteger nada.
  it("detecta un bind sin tipo inferible", async () => {
    expect(await prepareError("select jsonb_build_object('id', $1)")).toContain(
      "could not determine data type of parameter $1"
    )
    expect(
      await prepareError("select jsonb_build_object('id', $1::text)")
    ).toBeNull()
  })
})

async function prepareError(statement: string): Promise<string | null> {
  try {
    // Parse + Describe, sin Bind ni Execute: el paso en el que Postgres resuelve
    // los tipos de los parámetros.
    await database.db.describeQuery(statement)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function collectStatements(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const statements: string[] = []
  for (const entry of entries) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      statements.push(...(await collectStatements(child)))
      continue
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue
    if (entry.name.includes(".test.")) continue
    if ((await stat(child)).isFile()) {
      statements.push(...extractStatements(await readFile(child, "utf8")))
    }
  }
  return statements
}

// Las dos formas del tag que usa el repo: `this.sql\`...\`` (apps/api) y
// `sql\`...\`` con o sin argumento de tipo (apps/web).
const TAG = /(?:this\.)?\bsql(?:<[^`]*?>)?`/g

// Un template etiquetado que no empieza por un verbo SQL no es una sentencia:
// es una mención del tag dentro de un comentario o de una firma de tipo. Se
// descarta en vez de reportarla como error de sintaxis.
const SQL_VERB = /^(with|select|insert|update|delete|truncate|create|alter|drop)\b/i

function extractStatements(source: string): string[] {
  const statements: string[] = []
  TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG.exec(source))) {
    const { statement, end } = readTemplate(source, match.index + match[0].length)
    if (SQL_VERB.test(headline(statement))) statements.push(statement)
    // Continúa después del template para no volver a entrar en su interior.
    TAG.lastIndex = end
  }
  return statements
}

function readTemplate(
  source: string,
  start: number
): { statement: string; end: number } {
  let statement = ""
  let binds = 0
  let cursor = start
  while (cursor < source.length) {
    const character = source[cursor]!
    if (character === "\\") {
      statement += source.slice(cursor, cursor + 2)
      cursor += 2
      continue
    }
    if (character === "`") {
      cursor += 1
      break
    }
    if (character === "$" && source[cursor + 1] === "{") {
      // Salta la expresión interpolada contando llaves y deja en su lugar el
      // `$n` que Postgres va a ver. La numeración resultante es la del SQL
      // final —todas las interpolaciones desde el principio, las de los CTE
      // incluidas—, que es la que aparece en el mensaje de error.
      let depth = 1
      cursor += 2
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "{") depth += 1
        if (source[cursor] === "}") depth -= 1
        cursor += 1
      }
      binds += 1
      statement += `$${binds}`
      continue
    }
    statement += character
    cursor += 1
  }
  return { statement, end: cursor }
}

// Las dos primeras líneas útiles, para que un fallo diga qué sentencia es sin
// volcar cien líneas de SQL.
function headline(statement: string): string {
  return (
    statement
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("--"))
      .slice(0, 2)
      .join(" ")
      .slice(0, 120) || "(sentencia vacía)"
  )
}
