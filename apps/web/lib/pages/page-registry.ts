import type { ConnectedPage as MetaConnectedPage } from "@/lib/meta"
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"

import { normalizeWebhookUrl } from "./webhook-url"

export type PageStatus = "active" | "disconnected"

export type ConnectedPageRecord = {
  id: string
  tenantId: string
  metaPageId: string
  name: string
  status: PageStatus
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

export class InvalidWebhookUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidWebhookUrlError"
  }
}

export async function connectAuthorizedPages(
  tenantId: string,
  pages: MetaConnectedPage[]
) {
  if (pages.length === 0) return []

  const sql = getSql()

  return sql.begin(async (tx) => {
    const connected: ConnectedPageRecord[] = []

    for (const page of pages) {
      const encryptedToken = encryptSecret(page.pageAccessToken)
      const [existing] = await tx<ConnectedPageRow[]>`
        select id, tenant_id, meta_page_id, name, status, webhook_url,
          connected_at, disconnected_at, created_at, updated_at
        from connected_pages
        where meta_page_id = ${page.pageId}
        limit 1
      `

      if (existing && existing.tenant_id !== tenantId) {
        throw new PageOwnershipError(page.pageId)
      }

      if (existing) {
        const [updated] = await tx<ConnectedPageRow[]>`
          update connected_pages
          set name = ${page.name},
              status = 'active',
              page_access_token_encrypted = ${encryptedToken},
              connected_at = now(),
              disconnected_at = null,
              updated_at = now()
          where id = ${existing.id} and tenant_id = ${tenantId}
          returning id, tenant_id, meta_page_id, name, status, webhook_url,
            connected_at, disconnected_at, created_at, updated_at
        `
        if (updated) connected.push(mapConnectedPage(updated))
        continue
      }

      const [inserted] = await tx<ConnectedPageRow[]>`
        insert into connected_pages (
          tenant_id,
          meta_page_id,
          name,
          page_access_token_encrypted
        )
        values (${tenantId}, ${page.pageId}, ${page.name}, ${encryptedToken})
        returning id, tenant_id, meta_page_id, name, status, webhook_url,
          connected_at, disconnected_at, created_at, updated_at
      `
      if (inserted) connected.push(mapConnectedPage(inserted))
    }

    return connected
  })
}

export async function assertPagesConnectable(
  tenantId: string,
  pages: MetaConnectedPage[]
) {
  if (pages.length === 0) return

  const sql = getSql()

  for (const page of pages) {
    const [existing] = await sql<
      Pick<ConnectedPageRow, "meta_page_id" | "tenant_id">[]
    >`
      select meta_page_id, tenant_id
      from connected_pages
      where meta_page_id = ${page.pageId}
      limit 1
    `

    if (existing && existing.tenant_id !== tenantId) {
      throw new PageOwnershipError(existing.meta_page_id)
    }
  }
}

export async function listTenantPages(tenantId: string) {
  const sql = getSql()
  const rows = await sql<ConnectedPageRow[]>`
    select id, tenant_id, meta_page_id, name, status, webhook_url,
      connected_at, disconnected_at, created_at, updated_at
    from connected_pages
    where tenant_id = ${tenantId}
    order by case when status = 'active' then 0 else 1 end, updated_at desc
  `

  return rows.map(mapConnectedPage)
}

export async function updatePageWebhookUrl(
  tenantId: string,
  connectionId: string,
  webhookUrlInput: unknown
) {
  const normalized = normalizeWebhookUrl(webhookUrlInput)
  if (!normalized.ok) throw new InvalidWebhookUrlError(normalized.error)

  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    update connected_pages
    set webhook_url = ${normalized.value}, updated_at = now()
    where id = ${connectionId} and tenant_id = ${tenantId} and status = 'active'
    returning id, tenant_id, meta_page_id, name, status, webhook_url,
      connected_at, disconnected_at, created_at, updated_at
  `

  return row ? mapConnectedPage(row) : null
}

export async function disconnectPage(tenantId: string, connectionId: string) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    update connected_pages
    set status = 'disconnected',
        disconnected_at = coalesce(disconnected_at, now()),
        updated_at = now()
    where id = ${connectionId} and tenant_id = ${tenantId}
    returning id, tenant_id, meta_page_id, name, status, webhook_url,
      connected_at, disconnected_at, created_at, updated_at
  `

  return row ? mapConnectedPage(row) : null
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
    select id, tenant_id, meta_page_id, name, status, webhook_url,
      connected_at, disconnected_at, created_at, updated_at,
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
    select id, tenant_id, meta_page_id, name, status, webhook_url,
      connected_at, disconnected_at, created_at, updated_at
    from connected_pages
    where meta_page_id = ${metaPageId} and status = 'active'
    limit 1
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
    webhookUrl: row.webhook_url,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
