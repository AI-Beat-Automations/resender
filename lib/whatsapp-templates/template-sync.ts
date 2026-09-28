import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"
import { listWhatsappTemplates } from "@/lib/meta/whatsapp-template-client"
import { log } from "@/lib/observability/logger"

import { upsertSyncedWhatsappTemplates } from "./template-store"

// El job `template_sync`: trae el catálogo de plantillas de la WABA de una
// conexión y lo guarda en la copia local.
//
// Se encola al conectar un número (los dos flujos) y, una sola vez, para los
// que ya estaban conectados (`scripts/whatsapp-template-backfill.mjs`). Corre
// en la cola y no en el callback por lo mismo que el history sync: un fallo de
// Graph acá se reintenta, y en el callback se perdería con la request.
//
// El sync es **por WABA**, no por número: dos números de la misma WABA —aunque
// sean de tenants distintos— caen sobre las mismas filas, y el segundo sync es
// idempotente.

type SyncRow = {
  tenant_id: string
  waba_id: string | null
  page_access_token_encrypted: string
  status: string
}

export type TemplateSyncOutcome =
  | { ok: true; count: number }
  | { ok: false; permanent: true; reason: "connection_not_active" }

/**
 * Lista el catálogo en Graph y lo guarda. Un fallo de Graph lanza, y la cola
 * reintenta; una conexión que ya no existe o no está activa es un descarte y
 * no se reintenta.
 */
export async function syncWhatsappTemplates(input: {
  connectionId: string
}): Promise<TemplateSyncOutcome> {
  const sql = getSql()

  const [row] = await sql<SyncRow[]>`
    select tenant_id, waba_id, page_access_token_encrypted, status
    from connected_pages
    where id = ${input.connectionId}
      and channel = 'whatsapp'
    limit 1
  `

  // Sin fila, desconectada o sin WABA (una fila anterior a la 0017 que nunca
  // se reconectó): no hay catálogo que pedir ni token con qué pedirlo.
  if (!row || row.status !== "active" || !row.waba_id) {
    log({
      entrypoint: "queue",
      action: "template_sync",
      outcome: "dropped",
      reason: "connection_not_active",
      channel: "whatsapp",
      connectionId: input.connectionId,
      ...(row ? { tenantId: row.tenant_id } : {}),
    })
    return { ok: false, permanent: true, reason: "connection_not_active" }
  }

  const templates = await listWhatsappTemplates(
    decryptSecret(row.page_access_token_encrypted),
    row.waba_id
  )

  const count = await upsertSyncedWhatsappTemplates({
    wabaId: row.waba_id,
    templates,
  })

  log({
    entrypoint: "queue",
    action: "template_sync",
    outcome: "ok",
    channel: "whatsapp",
    tenantId: row.tenant_id,
    connectionId: input.connectionId,
    accountId: row.waba_id,
    count,
  })

  return { ok: true, count }
}
