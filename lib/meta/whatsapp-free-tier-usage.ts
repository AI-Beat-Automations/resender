import { getSql } from "@/lib/db"

import type {
  MetaFreeTierPeriod,
  MetaFreeTierThreshold,
  MetaFreeTierUsage,
} from "./whatsapp-free-tier"

// Repositorio del [Cupo gratis de Meta] (migraciones 0029 y 0030). Sin
// decisiones: qué significa cada número lo dice `whatsapp-free-tier.ts`.

/**
 * Mensajes de servicio entregados y cuántos de esos se cobraron, por número y
 * dentro del período. Cuenta por `meta_pricing_category = 'service'` y no solo
 * por `meta_billable`: Meta todavía no documenta cómo marca los del cupo
 * gratis, y la categoría es lo único estable (0029).
 *
 * `meta_billed_at` es el `delivered`, que es cuando Meta cobra: un mensaje
 * enviado el 31 y entregado el 1 cuenta en el mes nuevo. Los números sin
 * mensajes no vienen en el resultado; el que llama los toma como cero.
 */
export async function countMetaServiceUsage(
  connectedPageIds: string[],
  period: MetaFreeTierPeriod
): Promise<Map<string, MetaFreeTierUsage>> {
  const usage = new Map<string, MetaFreeTierUsage>()
  if (connectedPageIds.length === 0) return usage

  const sql = getSql()
  const rows = await sql<
    { connected_page_id: string; service_count: number; billed_count: number }[]
  >`
    select connected_page_id,
           count(*)::int as service_count,
           count(*) filter (where meta_billable)::int as billed_count
    from messages
    where connected_page_id = any(${connectedPageIds}::uuid[])
      and meta_pricing_category = 'service'
      and meta_billed_at >= ${period.start}::timestamptz
      and meta_billed_at < ${period.end}::timestamptz
    group by connected_page_id
  `

  for (const row of rows) {
    usage.set(row.connected_page_id, {
      serviceCount: row.service_count,
      billedCount: row.billed_count,
    })
  }
  return usage
}

/**
 * Reclama el correo de un umbral: `true` solo para el primero que inserta la
 * fila. Atómico sin transacción interactiva (el driver HTTP de Neon no las
 * tiene), así que dos acuses concurrentes no mandan dos correos.
 */
export async function claimMetaFreeTierAlert(input: {
  connectedPageId: string
  periodStart: Date
  threshold: MetaFreeTierThreshold
}): Promise<boolean> {
  const sql = getSql()
  const rows = await sql<{ threshold: number }[]>`
    insert into meta_free_tier_alerts (connected_page_id, period_start, threshold)
    values (${input.connectedPageId}, ${input.periodStart}::timestamptz,
            ${input.threshold})
    on conflict do nothing
    returning threshold
  `
  return rows.length > 0
}

/** Suelta el reclamo cuando el correo no salió, para que otro acuse reintente. */
export async function releaseMetaFreeTierAlert(input: {
  connectedPageId: string
  periodStart: Date
  threshold: MetaFreeTierThreshold
}): Promise<void> {
  const sql = getSql()
  await sql`
    delete from meta_free_tier_alerts
    where connected_page_id = ${input.connectedPageId}
      and period_start = ${input.periodStart}::timestamptz
      and threshold = ${input.threshold}
  `
}

/** El correo del dueño del tenant: el padre, también para los números de sus clientes. */
export async function getTenantOwnerEmail(
  tenantId: string
): Promise<string | null> {
  const sql = getSql()
  const [row] = await sql<{ email: string }[]>`
    select email from users where id = ${tenantId} limit 1
  `
  return row?.email ?? null
}
