import type { ConnectedPage as MetaConnectedPage } from "@/lib/meta"
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"

import type { PageOwnershipRow } from "./page-selection"

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

export class PageOwnershipError extends Error {
  constructor(public readonly metaPageId: string) {
    super("page already belongs to another tenant")
    this.name = "PageOwnershipError"
  }
}

export async function connectAuthorizedPages(
  tenantId: string,
  pages: MetaConnectedPage[]
) {
  if (pages.length === 0) return []

  const sql = getSql()

  // Fase de lectura (verifica propiedad) + batch atómico de escrituras: el
  // driver HTTP de Neon no soporta transacciones interactivas. Las guardas
  // `tenant_id = ${tenantId}` en el update y el unique de `meta_page_id` en el
  // insert cubren la carrera entre ambas fases.
  const writes: Promise<unknown>[] = []
  for (const page of pages) {
    const encryptedToken = encryptSecret(page.pageAccessToken)
    const [existing] = await sql<Pick<ConnectedPageRow, "id" | "tenant_id">[]>`
      select id, tenant_id
      from connected_pages
      where meta_page_id = ${page.pageId}
      limit 1
    `

    if (existing && existing.tenant_id !== tenantId) {
      throw new PageOwnershipError(page.pageId)
    }

    writes.push(
      existing
        ? sql`
            update connected_pages
            set name = ${page.name},
                status = 'active',
                token_status = 'valid',
                token_error = null,
                token_error_at = null,
                page_access_token_encrypted = ${encryptedToken},
                connected_at = now(),
                disconnected_at = null,
                updated_at = now()
            where id = ${existing.id} and tenant_id = ${tenantId}
            returning id, tenant_id, meta_page_id, name, status, token_status,
              token_error, token_error_at, webhook_url, connected_at,
              disconnected_at, created_at, updated_at
          `
        : sql`
            insert into connected_pages (
              tenant_id,
              meta_page_id,
              name,
              page_access_token_encrypted
            )
            values (${tenantId}, ${page.pageId}, ${page.name}, ${encryptedToken})
            returning id, tenant_id, meta_page_id, name, status, token_status,
              token_error, token_error_at, webhook_url, connected_at,
              disconnected_at, created_at, updated_at
          `
    )
  }

  const results = await sql.transaction(writes)
  return results.flatMap((rows) =>
    (rows as ConnectedPageRow[]).map(mapConnectedPage)
  )
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

// Ownership de una lista de páginas de Meta, de cualquier tenant y en
// cualquier estado: lo consume el módulo puro de selección, que decide página
// por página (ADR 0004). Ya no se lanza sobre la lista completa.
export async function getPageOwnership(
  metaPageIds: string[]
): Promise<PageOwnershipRow[]> {
  if (metaPageIds.length === 0) return []

  const sql = getSql()
  const rows = await sql<
    Pick<ConnectedPageRow, "meta_page_id" | "tenant_id" | "status">[]
  >`
    select meta_page_id, tenant_id, status
    from connected_pages
    where meta_page_id = any(${metaPageIds}::text[])
  `

  return rows.map((row) => ({
    metaPageId: row.meta_page_id,
    tenantId: row.tenant_id,
    status: row.status,
  }))
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
