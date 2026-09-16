import { getPlanByLookupKey } from "@/lib/billing/plans"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"

import { canManageClients } from "./client-rules"

// Lo que el módulo Clientes necesita saber del plan del padre, en una sola
// lectura: si puede invitar y hasta cuánto puede dar de tope a cada cliente.
// `maxPages` sigue siendo el nombre del cupo de conexiones (ADR 0011).
export type ClientPlan = {
  canManage: boolean
  /** Nulo si no hay plan resuelto: fail-closed, no se crea nada. */
  maxPages: number | null
}

export async function resolveClientPlan(tenantId: string): Promise<ClientPlan> {
  const subscription = await getSubscriptionByTenantId(tenantId)
  const lookupKey = subscription?.priceLookupKey ?? null
  const plan = lookupKey ? getPlanByLookupKey(lookupKey) : null
  return {
    canManage: canManageClients(lookupKey),
    maxPages: plan?.limits.maxPages ?? null,
  }
}
