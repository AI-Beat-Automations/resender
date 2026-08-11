import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"
import type { PageChannel, PageStatus } from "@/lib/pages/page-registry"

import type { DeletionPage } from "./account-deletion"

export type TenantDeletionContext = {
  email: string
  pages: DeletionPage[]
  stripeSubscriptionId: string | null
}

type ConnectedPageDeletionRow = {
  channel: PageChannel
  meta_page_id: string
  status: PageStatus
  page_access_token_encrypted: string
}

// Loads everything the deletion flow needs before the tenant row is wiped: the
// account email (for the confirmation check), the connected pages with their
// decrypted tokens (to plan best-effort Meta webhook unsubscribes) and the
// Stripe subscription id (to cancel it best-effort before the cascade delete).
export async function loadTenantDeletionContext(
  tenantId: string
): Promise<TenantDeletionContext | null> {
  const sql = getSql()

  const [user] = await sql<{ email: string }[]>`
    select email from users where id = ${tenantId} limit 1
  `
  if (!user) return null

  const rows = await sql<ConnectedPageDeletionRow[]>`
    select channel, meta_page_id, status, page_access_token_encrypted
    from connected_pages
    where tenant_id = ${tenantId}
  `

  const [subscription] = await sql<{ stripe_subscription_id: string }[]>`
    select stripe_subscription_id
    from subscriptions
    where tenant_id = ${tenantId}
    limit 1
  `

  return {
    email: user.email,
    pages: rows.map((row) => ({
      channel: row.channel,
      metaPageId: row.meta_page_id,
      status: row.status,
      pageAccessToken: decryptSecret(row.page_access_token_encrypted),
    })),
    stripeSubscriptionId: subscription?.stripe_subscription_id ?? null,
  }
}

// Deletes the tenant. The `on delete cascade` foreign keys (migration 0002)
// remove all dependent rows: connected pages, conversations, messages,
// external webhook deliveries and API keys.
export async function deleteTenant(tenantId: string): Promise<void> {
  const sql = getSql()
  await sql`delete from users where id = ${tenantId}`
}
