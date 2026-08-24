import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"
import { requestWhatsappHistorySync } from "@/lib/meta/whatsapp-client"
import { updateWhatsappHistorySyncStatus } from "@/lib/pages/page-registry"
import { log } from "@/lib/observability/logger"

// Pedido del sync de historial de Coexistence.
//
// **El sync no llega solo: hay que pedirlo.** Es la parte del flujo B que más
// fácil se cae en silencio, porque nada falla visiblemente si no se pide —
// simplemente no llega ningún `history` y el número queda conectado y vacío—.
// Y hay un **plazo duro de 24 horas**: pasado ese rato sin `progress: 100`, la
// conexión hay que rehacerla entera desde el Embedded Signup.
//
// Por eso vive en la cola y no en el callback: el callback tiene que devolverle
// una respuesta al navegador, y un fallo de red contra Meta ahí adentro se
// perdería con la request. Acá se reintenta, y si se agotan los reintentos el
// estado queda `failed`, que Connections muestra como acción concreta y no como
// un detalle.

type SyncRow = {
  tenant_id: string
  meta_page_id: string
  page_access_token_encrypted: string
  history_sync_status: string | null
  status: string
}

export type HistorySyncOutcome =
  | { ok: true }
  | { ok: false; permanent: true; reason: string }

/**
 * Pide el sync y mueve `history_sync_status` a `requested`.
 *
 * Idempotente por estado: si la conexión ya pasó de `not_requested`, no vuelve a
 * pedirlo. Un segundo pedido no es gratis —arranca otra vez el reloj del lado de
 * Meta y puede duplicar chunks— así que el reintento de la cola tiene que poder
 * repetirse sin repetir la llamada.
 */
export async function requestHistorySync(input: {
  connectionId: string
}): Promise<HistorySyncOutcome> {
  const sql = getSql()

  const [row] = await sql<SyncRow[]>`
    select tenant_id, meta_page_id, page_access_token_encrypted,
           history_sync_status, status
    from connected_pages
    where id = ${input.connectionId}
      and channel = 'whatsapp'
    limit 1
  `

  if (!row) {
    // La conexión se borró entre el callback y el job. No hay nada que pedir.
    return { ok: false, permanent: true, reason: "connection_not_found" }
  }

  if (row.status !== "active") {
    return { ok: false, permanent: true, reason: "connection_not_active" }
  }

  if (row.history_sync_status && row.history_sync_status !== "not_requested") {
    // Ya se pidió. Incluye el caso `expired`: volver a pedirlo sobre una
    // conexión vencida no la revive —hay que rehacer el Embedded Signup— y
    // pedirlo de nuevo solo confundiría el estado que ve el tenant.
    return { ok: true }
  }

  await requestWhatsappHistorySync(
    decryptSecret(row.page_access_token_encrypted),
    row.meta_page_id
  )

  await updateWhatsappHistorySyncStatus({
    connectionId: input.connectionId,
    status: "requested",
  })

  log({
    entrypoint: "queue",
    action: "account_connect",
    outcome: "ok",
    channel: "whatsapp",
    tenantId: row.tenant_id,
    connectionId: input.connectionId,
    accountId: row.meta_page_id,
  })

  return { ok: true }
}

/**
 * Se agotaron los reintentos. El estado pasa a `failed` para que Connections lo
 * muestre como algo que el tenant puede accionar: sin esto, la conexión se
 * queda callada hasta que vencen las 24 h y nadie se entera de por qué.
 */
export async function markHistorySyncFailed(connectionId: string) {
  await updateWhatsappHistorySyncStatus({ connectionId, status: "failed" })

  log({
    entrypoint: "queue",
    action: "account_connect",
    outcome: "failed",
    reason: "history_sync_failed",
    channel: "whatsapp",
    connectionId,
  })
}
