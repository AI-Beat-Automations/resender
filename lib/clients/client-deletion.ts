import {
  deletedConnectionIds,
  planWebhookUnsubscribes,
  type DeletionPage,
} from "@/lib/account/account-deletion"
import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"
import { describeError, log } from "@/lib/observability/logger"
import { unsubscribeChannelWebhook } from "@/lib/pages/channel-webhook"
import type { PageChannel, PageStatus } from "@/lib/pages/page-registry"

import { getClientAccount, type ClientAccountRecord } from "./client-accounts"

// Borrar un cliente (issue #154): desconecta cada conexión con la misma baja
// del webhook de Meta que la desconexión normal, borra el user del cliente si
// ya aceptó, y borra el espacio. Las conexiones, sus conversaciones y sus
// mensajes caen por cascade (migración 0027 + 0002). Nada vuelve al padre.
//
// Es **un solo procedimiento** para dos llamadores: la acción «Eliminar» de
// `/clientes` y el borrado de cuenta del padre, que elimina primero a sus
// clientes. Por eso vive en `lib/` y no en `features/clients`.

type ClientPageRow = {
  id: string
  channel: PageChannel
  meta_page_id: string
  waba_id: string | null
  status: PageStatus
  page_access_token_encrypted: string
}

export type ClientDeletionContext = {
  client: ClientAccountRecord
  pages: DeletionPage[]
}

export async function loadClientDeletionContext(
  tenantId: string,
  clientAccountId: string
): Promise<ClientDeletionContext | null> {
  const client = await getClientAccount(tenantId, clientAccountId)
  if (!client) return null

  const sql = getSql()
  const rows = await sql<ClientPageRow[]>`
    select id, channel, meta_page_id, waba_id, status,
           page_access_token_encrypted
    from connected_pages
    where tenant_id = ${tenantId}
      and client_account_id = ${clientAccountId}
  `

  return {
    client,
    pages: rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      metaPageId: row.meta_page_id,
      wabaId: row.waba_id,
      status: row.status,
      pageAccessToken: decryptSecret(row.page_access_token_encrypted),
    })),
  }
}

// Borra las filas. Si el cliente ya aceptó, borrar su `users` se lleva el
// espacio por el cascade de `client_accounts.user_id`; si no, se borra el
// espacio directo. En los dos casos `connected_pages.client_account_id`
// arrastra las conexiones.
export async function deleteClientRows(
  client: ClientAccountRecord
): Promise<void> {
  const sql = getSql()
  if (client.userId) {
    await sql`delete from users where id = ${client.userId}`
  }
  await sql`
    delete from client_accounts
    where id = ${client.id} and tenant_id = ${client.tenantId}
  `
}

/**
 * El procedimiento completo. Devuelve el cliente borrado, o `null` si no era
 * de este tenant. La baja en Meta es best-effort y va **antes** del borrado:
 * un fallo ahí no bloquea el borrado, pero queda en el log.
 */
export async function deleteClientWithConnections(
  tenantId: string,
  clientAccountId: string
): Promise<ClientAccountRecord | null> {
  const context = await loadClientDeletionContext(tenantId, clientAccountId)
  if (!context) return null

  // Como en el borrado de cuenta: las conexiones que este borrado elimina no
  // pueden contarse a sí mismas al decidir si el WABA sigue con números vivos.
  const excludeConnectionIds = deletedConnectionIds(context.pages)
  const results = await Promise.allSettled(
    planWebhookUnsubscribes(context.pages).map((page) =>
      unsubscribeChannelWebhook({
        channel: page.channel,
        metaPageId: page.metaPageId,
        accessToken: page.pageAccessToken,
        wabaId: page.wabaId,
        excludeConnectionIds,
      })
    )
  )
  for (const result of results) {
    if (result.status === "rejected") {
      log({
        entrypoint: "action",
        action: "webhook_unsubscribe",
        outcome: "failed",
        reason: "unsubscribe_failed",
        tenantId,
        clientAccountId,
        errorMessage: describeError(result.reason),
      })
    }
  }

  await deleteClientRows(context.client)
  return context.client
}

// Los clientes de un padre, para que el borrado de cuenta los elimine uno a
// uno con el mismo procedimiento antes de borrarse a sí mismo.
export async function listClientAccountIds(
  tenantId: string
): Promise<string[]> {
  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    select id from client_accounts where tenant_id = ${tenantId}
  `
  return rows.map((row) => row.id)
}

export async function deleteAllClientsOfTenant(
  tenantId: string
): Promise<void> {
  for (const clientAccountId of await listClientAccountIds(tenantId)) {
    await deleteClientWithConnections(tenantId, clientAccountId)
  }
}
