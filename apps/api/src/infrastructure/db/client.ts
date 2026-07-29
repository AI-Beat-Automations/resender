import { neon, type NeonQueryFunction } from "@neondatabase/serverless"

export type Sql = NeonQueryFunction<false, false>

export type SqlTransport = {
  create(databaseUrl: string): Sql
}

export const sqlTransport: SqlTransport = {
  create(databaseUrl) {
    return neon(databaseUrl)
  },
}

export function createSql(databaseUrl: string): Sql {
  if (!databaseUrl) throw new Error("DATABASE_URL is required")
  return sqlTransport.create(databaseUrl)
}
