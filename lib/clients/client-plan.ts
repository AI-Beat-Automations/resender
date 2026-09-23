import {
  isPaidStatus,
  resolveTenantPlanLimits,
} from "@/lib/billing/entitlements"
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
  // Una suscripción que dejó de estar `active` conserva su lookup key en la
  // fila, pero el tenant ya está en el Free derivado (ADR 0022): sin Clientes.
  const lookupKey = isPaidStatus(subscription?.status)
    ? (subscription?.priceLookupKey ?? null)
    : null
  return {
    canManage: canManageClients(lookupKey),
    maxPages: resolveTenantPlanLimits(subscription)?.maxPages ?? null,
  }
}
