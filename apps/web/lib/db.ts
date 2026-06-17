import postgres from "postgres"

let client: ReturnType<typeof postgres> | undefined

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required")
  }

  client ??= postgres(databaseUrl, {
    max: 10,
    prepare: false,
  })

  return client
}

export async function closeSql() {
  if (!client) return
  await client.end()
  client = undefined
}
