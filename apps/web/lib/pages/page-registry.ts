import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"

export type PageStatus = "active" | "disconnected"
export type PageTokenStatus = "valid" | "invalid"

export type ConnectedPageRecord = {
  id: string
  tenantId: string
  metaPageId: string
  name: string
  status: PageStatus
  tokenStatus: PageTokenStatus
  tokenError: string | null
  tokenErrorAt: Date | null
  webhookUrl: string | null
  connectedAt: Date
  disconnectedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type ConnectedPageRow = {
  id: string
  tenant_id: string
  meta_page_id: string
  name: string
  status: PageStatus
  token_status: PageTokenStatus
  token_error: string | null
  token_error_at: Date | null
  webhook_url: string | null
  connected_at: Date
  disconnected_at: Date | null
  created_at: Date
  updated_at: Date
}

type ConnectedPageWithTokenRow = ConnectedPageRow & {
  page_access_token_encrypted: string
}

// Cupo del plan: cuenta solo las páginas `active` (desconectar es un UPDATE,
// no un DELETE, y las desconectadas no ocupan cupo).
export async function countActivePages(tenantId: string): Promise<number> {
  const sql = getSql()
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from connected_pages
    where tenant_id = ${tenantId} and status = 'active'
  `

  return row?.count ?? 0
}

export async function getActivePageTokenForTenant(
  tenantId: string,
  metaPageId: string
) {
  const sql = getSql()
  const [row] = await sql<{ page_access_token_encrypted: string }[]>`
    select page_access_token_encrypted
    from connected_pages
    where tenant_id = ${tenantId}
      and meta_page_id = ${metaPageId}
      and status = 'active'
    limit 1
  `

  if (!row) return null
  return decryptSecret(row.page_access_token_encrypted)
}

export async function getActivePageWithTokenForTenant(
  tenantId: string,
  metaPageId: string
) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageWithTokenRow[]>`
    select id, tenant_id, meta_page_id, name, status, token_status,
      token_error, token_error_at, webhook_url, connected_at, disconnected_at,
      created_at, updated_at,
      page_access_token_encrypted
    from connected_pages
    where tenant_id = ${tenantId}
      and meta_page_id = ${metaPageId}
      and status = 'active'
    limit 1
  `

  if (!row) return null

  return {
    page: mapConnectedPage(row),
    pageAccessToken: decryptSecret(row.page_access_token_encrypted),
  }
}

export async function getActivePageByMetaPageId(metaPageId: string) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    select id, tenant_id, meta_page_id, name, status, token_status,
      token_error, token_error_at, webhook_url, connected_at, disconnected_at,
      created_at, updated_at
    from connected_pages
    where meta_page_id = ${metaPageId} and status = 'active'
    limit 1
  `

  return row ? mapConnectedPage(row) : null
}

export async function markPageTokenInvalid(input: {
  tenantId: string
  connectionId: string
  error: string
}) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    update connected_pages
    set token_status = 'invalid',
        token_error = ${input.error},
        token_error_at = now(),
        updated_at = now()
    where id = ${input.connectionId}
      and tenant_id = ${input.tenantId}
      and status = 'active'
    returning id, tenant_id, meta_page_id, name, status, token_status,
      token_error, token_error_at, webhook_url, connected_at, disconnected_at,
      created_at, updated_at
  `

  return row ? mapConnectedPage(row) : null
}

function mapConnectedPage(row: ConnectedPageRow): ConnectedPageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    metaPageId: row.meta_page_id,
    name: row.name,
    status: row.status,
    tokenStatus: row.token_status,
    tokenError: row.token_error,
    tokenErrorAt: row.token_error_at,
    webhookUrl: row.webhook_url,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
