import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import postgres from "postgres"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await loadEnvFile(path.join(appDir, ".env"))

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations")
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1 })
const migrationsDir = path.join(process.cwd(), "db", "migrations")

async function loadEnvFile(filePath) {
  let contents

  try {
    contents = await readFile(filePath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("#")) continue

    const separator = trimmed.indexOf("=")
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).replace(/^export\s+/, "").trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue
    }

    let value = trimmed.slice(separator + 1).trim()
    const quote = value[0]

    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1)

      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r")
      }
    }

    process.env[key] = value
  }
}

try {
  await sql`
    create table if not exists _echo_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort()

  for (const file of files) {
    const [{ exists }] = await sql`
      select exists(select 1 from _echo_migrations where name = ${file})
    `

    if (exists) continue

    const migration = await readFile(path.join(migrationsDir, file), "utf8")
    await sql.begin(async (tx) => {
      await tx.unsafe(migration)
      await tx`insert into _echo_migrations (name) values (${file})`
    })
    console.log(`applied ${file}`)
  }
} finally {
  await sql.end()
}
