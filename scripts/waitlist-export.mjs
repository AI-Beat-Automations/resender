import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import postgres from "postgres"

import { loadEnvFile } from "./load-env.mjs"

// Volcado a CSV de la lista de espera pública (ADR 0007). Sin este script los
// correos solo se pueden sacar abriendo la consola de Neon, y una lista que no
// se puede extraer no sirve: es lo único que garantiza que los datos salgan de
// ahí mientras no exista canal de correo en el repo.
//
// Uso:
//   npm run waitlist:export                 → imprime el CSV en pantalla
//   npm run waitlist:export > lista.csv     → lo guarda
//
// El CSV sale por **stdout** y nada más: los mensajes de progreso van a stderr
// para que la redirección de arriba produzca un archivo limpio. Si se mezclaran,
// el CSV traería una primera línea que ningún importador entiende.
//
// Las filas salen ordenadas por `created_at asc` (orden de registro), que es el
// que hace falta para leer la lista como historia y el que conserva la
// atribución first-touch: la primera fila de un correo es la única que existe.
//
// Se exportan también las dadas de baja, con su `unsubscribed_at`: quien arme
// el envío tiene que poder excluirlas, y filtrarlas acá escondería que existen.

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await loadEnvFile(path.join(appDir, ".env"))

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL is required to export the waitlist")
  process.exit(1)
}

const COLUMNS = [
  "id",
  "email",
  "source",
  "heard_from",
  "heard_from_other",
  "consent_at",
  "consent_version",
  "unsubscribed_at",
  "created_at",
]

// Escapado CSV (RFC 4180): un campo se entrecomilla si contiene coma, comilla
// doble o salto de línea, y las comillas internas se duplican. `heard_from_other`
// es texto libre escrito por desconocidos, así que es exactamente donde esto
// deja de ser teórico.
function toCsvField(value) {
  if (value === null || value === undefined) return ""

  const raw = value instanceof Date ? value.toISOString() : String(value)

  // Un campo que arranca con `= + - @` lo interpreta como fórmula cualquier
  // hoja de cálculo al abrir el archivo. `heard_from_other` es texto libre
  // escrito por desconocidos, así que se neutraliza con una comilla simple
  // delante: el valor se ve igual y deja de ejecutarse.
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  if (!/[",\r\n]/.test(text)) return text

  return `"${text.replaceAll('"', '""')}"`
}

function toCsvRow(values) {
  return values.map(toCsvField).join(",")
}

const sql = postgres(databaseUrl, { max: 1 })

try {
  const rows = await sql`
    select id, email, source, heard_from, heard_from_other, consent_at,
      consent_version, unsubscribed_at, created_at
    from waitlist_signups
    order by created_at asc
  `

  const lines = [toCsvRow(COLUMNS)]
  for (const row of rows) {
    lines.push(toCsvRow(COLUMNS.map((column) => row[column])))
  }

  process.stdout.write(`${lines.join("\n")}\n`)
  console.error(`${rows.length} registro(s) exportado(s)`)
} finally {
  await sql.end()
}
