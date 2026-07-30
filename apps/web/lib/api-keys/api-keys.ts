import { getSql } from "@/lib/db"

import { hashApiKey, isApiKeyFormat, safeEqualHash } from "./tokens"

export type AuthenticatedApiKey = {
  id: string
  tenantId: string
}

type ApiKeyAuthRow = {
  id: string
  tenant_id: string
  secret_hash: string
  status: "active" | "revoked"
}

export async function authenticateApiKey(apiKey: unknown) {
  if (!isApiKeyFormat(apiKey)) return null

  const secretHash = hashApiKey(apiKey)
  const sql = getSql()
  const [row] = await sql<ApiKeyAuthRow[]>`
    select id, tenant_id, label, visible_prefix, secret_hash, status,
      created_at, last_used_at, revoked_at
    from api_keys
    where secret_hash = ${secretHash}
    limit 1
  `

  if (!row || row.status !== "active") return null
  if (!safeEqualHash(row.secret_hash, secretHash)) return null

  const [used] = await sql<{ id: string; tenant_id: string }[]>`
    update api_keys
    set last_used_at = now()
    where id = ${row.id} and status = 'active'
    returning id, tenant_id
  `

  if (!used) return null

  return {
    id: used.id,
    tenantId: used.tenant_id,
  } satisfies AuthenticatedApiKey
}
