import { countActivePages } from "@/lib/pages/page-registry"

import {
  evaluateEntitlement,
  resolvePlanLimits,
  resolveQuotaPeriodStart,
  type TenantEntitlement,
} from "./entitlements"
import { getSubscriptionByTenantId } from "./subscription"
import { getUsage } from "./usage-counter"

// Orquestador impuro del entitlement (ADR 0003): lee los valores planos que el
// módulo puro necesita y le delega toda la decisión. El consumo depende del
// período, y el período sale del módulo puro, así que la lectura ocurre en dos
// tiempos: plan y período primero, contador después.

export async function getTenantEntitlement(
  tenantId: string,
  now = new Date()
): Promise<TenantEntitlement> {
  const [subscription, activePageCount] = await Promise.all([
    getSubscriptionByTenantId(tenantId),
    countActivePages(tenantId),
  ])

  const priceLookupKey = subscription?.priceLookupKey ?? null
  const currentPeriodStart = subscription?.currentPeriodStart ?? null
  const currentPeriodEnd = subscription?.currentPeriodEnd ?? null

  // Sin plan o sin período no hay contador que leer: el bloqueo ya está
  // decidido y una consulta más sería gasto puro en el hot path.
  const limits = resolvePlanLimits(priceLookupKey)
  const periodStart = resolveQuotaPeriodStart({
    currentPeriodStart,
    currentPeriodEnd,
    now,
  })
  const usage =
    limits && periodStart ? await getUsage(tenantId, periodStart) : 0

  return evaluateEntitlement({
    priceLookupKey,
    currentPeriodStart,
    currentPeriodEnd,
    now,
    usage,
    activePageCount,
  })
}
