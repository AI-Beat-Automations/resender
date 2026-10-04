import type { TenantEntitlement } from "@/lib/billing/entitlements"
import { QUOTA_WARNING_RATIO } from "@/lib/billing/entitlements"
import { captureDeferred } from "@/lib/posthog"

import { analyticsPlanOfLimits, type AnalyticsPlan } from "./plans"

// Lo que los eventos de mensajes necesitan saber del plan del dueño, sacado del
// entitlement que cada ruta ya resolvió para decidir la cuota: ni una consulta
// más en el hot path.
export type QuotaContext = {
  plan: AnalyticsPlan
  // Mensajes del período; null si el plan no resolvió (fail-closed).
  limit: number | null
}

export function quotaContextOf(
  entitlement: Pick<TenantEntitlement, "isFree" | "limits">
): QuotaContext {
  return {
    plan: analyticsPlanOfLimits(entitlement.isFree, entitlement.limits),
    limit: entitlement.limits?.messagesPerPeriod ?? null,
  }
}

// Propiedades comunes de `message received` / `message sent`: a qué conexión y
// a qué [Cliente] pertenece el mensaje, y el plan del dueño en ese momento.
export function messageEventProperties(
  page: { id: string; clientAccountId: string | null },
  quota: QuotaContext
) {
  return {
    connection_id: page.id,
    client_id: page.clientAccountId,
    plan: quota.plan,
  }
}

// Umbrales de `message limit reached`, en porcentaje del límite del plan. El
// 80 es el mismo corte que el [Aviso de cuota].
const THRESHOLDS = [Math.round(QUOTA_WARNING_RATIO * 100), 100] as const

// El conteo exacto que cruza cada umbral, o ninguno. `incrementUsage` es un
// `+1` atómico que devuelve el valor nuevo, así que cada valor del contador lo
// ve **una sola** request por período: comparar por igualdad alcanza para
// mandar el evento una vez por umbral y período sin otra tabla de dedupe.
export function crossedThreshold(
  usage: number,
  limit: number | null
): (typeof THRESHOLDS)[number] | null {
  if (!limit || limit <= 0) return null
  for (const threshold of THRESHOLDS) {
    if (usage === Math.ceil((limit * threshold) / 100)) return threshold
  }
  return null
}

// Llamar con el valor que devolvió `incrementUsage`. No lanza.
export function captureUsageThreshold(
  tenantId: string,
  usage: number,
  quota: QuotaContext
): void {
  const threshold = crossedThreshold(usage, quota.limit)
  if (threshold === null) return
  captureDeferred({
    distinctId: tenantId,
    event: "message limit reached",
    properties: {
      threshold,
      plan: quota.plan,
      messages_used: usage,
      messages_limit: quota.limit,
    },
  })
}
