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
  id: string
  channel: PageChannel
  meta_page_id: string
  waba_id: string | null
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

  // `id` y `waba_id` son de WhatsApp: el WABA es el nodo que se desuscribe, y
  // el id de la fila es lo que se excluye de la cuenta de números activos para
  // que las conexiones que este borrado elimina no se cuenten a sí mismas.
  const rows = await sql<ConnectedPageDeletionRow[]>`
    select id, channel, meta_page_id, waba_id, status,
           page_access_token_encrypted
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
      id: row.id,
      channel: row.channel,
      metaPageId: row.meta_page_id,
      wabaId: row.waba_id,
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
