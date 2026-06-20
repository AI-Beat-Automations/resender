import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"
import type { PageStatus } from "@/lib/pages/page-registry"

import type { DeletionPage } from "./account-deletion"

export type TenantDeletionContext = {
  email: string
  pages: DeletionPage[]
}

type ConnectedPageDeletionRow = {
  meta_page_id: string
  status: PageStatus
  page_access_token_encrypted: string
}

// Loads everything the deletion flow needs before the tenant row is wiped: the
// account email (for the confirmation check) and the connected pages with their
// decrypted tokens (to plan best-effort Meta webhook unsubscribes).
export async function loadTenantDeletionContext(
  tenantId: string
): Promise<TenantDeletionContext | null> {
  const sql = getSql()

  const [user] = await sql<{ email: string }[]>`
    select email from users where id = ${tenantId} limit 1
  `
  if (!user) return null

  const rows = await sql<ConnectedPageDeletionRow[]>`
    select meta_page_id, status, page_access_token_encrypted
    from connected_pages
    where tenant_id = ${tenantId}
  `

  return {
    email: user.email,
    pages: rows.map((row) => ({
      metaPageId: row.meta_page_id,
      status: row.status,
      pageAccessToken: decryptSecret(row.page_access_token_encrypted),
    })),
  }
}

// Deletes the tenant. The `on delete cascade` foreign keys (migration 0002)
// remove all dependent rows: connected pages, conversations, messages,
// external webhook deliveries and API keys.
export async function deleteTenant(tenantId: string): Promise<void> {
  const sql = getSql()
  await sql`delete from users where id = ${tenantId}`
}
