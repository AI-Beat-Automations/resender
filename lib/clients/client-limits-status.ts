import { resolveTenantPlanLimits } from "@/lib/billing/entitlements"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"
import {
  countActiveClientPages,
  countActivePages,
} from "@/lib/pages/page-registry"

import { getClientAccount } from "./client-accounts"
import { evaluateClientLimits, type ClientLimits } from "./client-limits"
import { getClientOwner, ownerDisplayName } from "./client-owner"

// El lado impuro de `client-limits`, como `entitlement-status.ts` lo es de
// `entitlements.ts`: junta las cuatro lecturas y delega la decisión al módulo
// puro. Lo llaman los tres caminos de conexión y la pantalla de Conexiones
// cuando el actor es un cliente.

export type ClientLimitsStatus =
  | { ok: true; limits: ClientLimits; ownerName: string | null }
  /**
   * Fail-closed, como el resto de los gates: sin plan resuelto o sin fila de
   * cliente no se conecta nada. `client_not_found` no debería pasar —el actor
   * se resolvió con esa misma fila— salvo que el padre lo eliminara entre
   * medio.
   */
  | { ok: false; reason: "plan_unresolved" | "client_not_found" }

export async function getClientLimits(scope: {
  tenantId: string
  clientAccountId: string
}): Promise<ClientLimitsStatus> {
  const [subscription, tenantActiveCount, clientActiveCount, client, owner] =
    await Promise.all([
      getSubscriptionByTenantId(scope.tenantId),
      countActivePages(scope.tenantId),
      countActiveClientPages(scope.tenantId, scope.clientAccountId),
      getClientAccount(scope.tenantId, scope.clientAccountId),
      getClientOwner(scope.tenantId),
    ])

  const limits = resolveTenantPlanLimits(subscription)
  if (!limits) return { ok: false, reason: "plan_unresolved" }
  if (!client) return { ok: false, reason: "client_not_found" }

  return {
    ok: true,
    limits: evaluateClientLimits({
      planMaxPages: limits.maxPages,
      tenantActiveCount,
      clientMaxConnections: client.maxConnections,
      clientActiveCount,
    }),
    ownerName: owner ? ownerDisplayName(owner) : null,
  }
}
