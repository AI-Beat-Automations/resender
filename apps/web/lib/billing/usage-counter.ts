import { getSql } from "@/lib/db"

// Contador denormalizado de mensajes por (tenant, período de facturación)
// (ADR 0003). Derivarlo de `messages` con un `count(*)` pondría un index scan
// de hasta 100.000 filas en cada envío y cada entrante; `messages` queda como
// bitácora de auditoría para reconciliar. Repositorio puro: toda la decisión
// vive en `lib/billing/entitlements.ts`.

// Un único statement atómico: el driver HTTP de Neon no soporta transacciones
// interactivas (mismo motivo documentado en `lib/pages/page-registry.ts`), así
// que el `on conflict do update` es la única primitiva atómica disponible.
export async function incrementUsage(
  tenantId: string,
  periodStart: Date
): Promise<number> {
  const sql = getSql()
  const [row] = await sql<{ message_count: number }[]>`
    insert into usage_counters (tenant_id, period_start, message_count)
    values (${tenantId}, ${periodStart}, 1)
    on conflict (tenant_id, period_start) do update set
      message_count = usage_counters.message_count + 1,
      updated_at = now()
    returning message_count
  `
  return row?.message_count ?? 0
}

// Sin fila todavía no hubo consumo en el período: 0, no null.
export async function getUsage(
  tenantId: string,
  periodStart: Date
): Promise<number> {
  const sql = getSql()
  const [row] = await sql<{ message_count: number }[]>`
    select message_count
    from usage_counters
    where tenant_id = ${tenantId} and period_start = ${periodStart}
    limit 1
  `
  return row?.message_count ?? 0
}
