import { neon, type NeonQueryFunction } from "@neondatabase/serverless"

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

let client: NeonQueryFunction<false, false> | undefined

// El cliente crudo del driver, sin el disfraz de postgres.js. Lo necesita
// `lib/auth/auth.ts`: el adaptador de Better Auth habla Kysely, y el dialecto
// `kysely-neon` pide un cliente con `.query(sql, params, opts)` — que es
// justamente lo que el cast a `Sql` esconde. **No** es un segundo driver: es el
// mismo objeto memoizado que devuelve `getSql()`.
export function getNeonClient(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required")
  }

  client ??= neon(databaseUrl)
  return client
}

export function getSql(): Sql {
  return getNeonClient() as unknown as Sql
}
