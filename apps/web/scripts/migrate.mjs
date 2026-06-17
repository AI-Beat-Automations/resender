import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import postgres from "postgres"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations")
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1 })
const migrationsDir = path.join(process.cwd(), "db", "migrations")

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
