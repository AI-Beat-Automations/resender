import { getSql } from "@/lib/db"

import { generateApiKey, hashApiKey, isApiKeyFormat, safeEqualHash } from "./tokens"

export type ApiKeyStatus = "active" | "revoked"

export type ApiKeyRecord = {
  id: string
  tenantId: string
  label: string
  visiblePrefix: string
  status: ApiKeyStatus
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

export type AuthenticatedApiKey = {
  id: string
  tenantId: string
}

type ApiKeyRow = {
  id: string
  tenant_id: string
  label: string
  visible_prefix: string
  status: ApiKeyStatus
  created_at: Date
  last_used_at: Date | null
  revoked_at: Date | null
}

type ApiKeyAuthRow = ApiKeyRow & {
  secret_hash: string
}

export class InvalidApiKeyLabelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidApiKeyLabelError"
  }
}

export async function createApiKey(tenantId: string, labelInput: unknown) {
  const label = normalizeLabel(labelInput)
  const generated = generateApiKey()
  const sql = getSql()

  const [row] = await sql<ApiKeyRow[]>`
    insert into api_keys (tenant_id, label, visible_prefix, secret_hash)
    values (${tenantId}, ${label}, ${generated.visiblePrefix}, ${generated.secretHash})
    returning id, tenant_id, label, visible_prefix, status,
      created_at, last_used_at, revoked_at
  `

  if (!row) throw new Error("api key insert failed")

  return {
    apiKey: generated.apiKey,
    record: mapApiKey(row),
  }
}

export async function listApiKeys(tenantId: string) {
  const sql = getSql()
  const rows = await sql<ApiKeyRow[]>`
    select id, tenant_id, label, visible_prefix, status,
      created_at, last_used_at, revoked_at
    from api_keys
    where tenant_id = ${tenantId}
    order by created_at desc
  `

  return rows.map(mapApiKey)
}

export async function revokeApiKey(tenantId: string, apiKeyId: string) {
  const sql = getSql()
  const [row] = await sql<ApiKeyRow[]>`
    update api_keys
    set status = 'revoked', revoked_at = coalesce(revoked_at, now())
    where id = ${apiKeyId} and tenant_id = ${tenantId}
    returning id, tenant_id, label, visible_prefix, status,
      created_at, last_used_at, revoked_at
  `

  return row ? mapApiKey(row) : null
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

function normalizeLabel(labelInput: unknown) {
  const label = typeof labelInput === "string" ? labelInput.trim() : ""
  if (label.length < 1) {
    throw new InvalidApiKeyLabelError("El label es obligatorio.")
  }
  if (label.length > 80) {
    throw new InvalidApiKeyLabelError("El label no puede superar 80 caracteres.")
  }
  return label
}

function mapApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label,
    visiblePrefix: row.visible_prefix,
    status: row.status,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }
}
