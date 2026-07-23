import { neon } from "@neondatabase/serverless"

// Driver HTTP de Neon (stateless, apto para Cloudflare Workers) expuesto con
// la firma del tag de postgres.js (`sql<Row[]>`) para no tocar los call sites.
// Las queries sin await son lazy: se pueden agrupar en `sql.transaction([...])`,
// que ejecuta el batch de forma atómica (no interactiva).
export type Sql = (<T extends readonly unknown[] = Record<string, unknown>[]>(
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<T>) & {
  transaction(queries: Promise<unknown>[]): Promise<unknown[]>
}

let client: Sql | undefined

export function getSql(): Sql {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required")
  }

  client ??= neon(databaseUrl) as unknown as Sql
  return client
}
