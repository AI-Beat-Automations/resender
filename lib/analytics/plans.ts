import { FREE_PLAN, getPlanByLookupKey, PLANS } from "@/lib/billing/plans"
import type { PlanLimits } from "@/lib/billing/plans"

// Vocabulario de plan que ve PostHog. Es más corto que la lookup key de Stripe
// (`starter_monthly`) a propósito: los dashboards separan por `plan` y no
// tienen por qué saber que existe un ciclo de facturación.
export type AnalyticsPlan = "free" | "starter" | "pro" | "business"

// Estado de cobro de la persona en PostHog. `coupon_period` es una suscripción
// `active` cuyo primer cobro todavía lo cubre un cupón: Stripe la ve igual que
// una paga, pero para el MRR real todavía no aportó nada.
export type AnalyticsSubscriptionStatus =
  | "none"
  | "coupon_period"
  | "active"
  | "past_due"
  | "canceled"

// Una lookup key desconocida cae en `free` y no en `null`: el dashboard
// necesita un valor en cada persona, y un price mal configurado ya lo grita
// el entitlement (fail-closed) por otro lado.
export function analyticsPlanOf(
  lookupKey: string | null | undefined
): AnalyticsPlan {
  switch (lookupKey) {
    case "starter_monthly":
      return "starter"
    case "pro_monthly":
      return "pro"
    case "business_monthly":
      return "business"
    default:
      return "free"
  }
}

// Precio de lista en dólares, sin descuentos: es lo que el plan aporta al MRR
// una vez que el cupón termina. El precio sale del catálogo, no de Stripe.
export function planMrr(plan: AnalyticsPlan): number {
  if (plan === "free") return FREE_PLAN.priceMonthlyUsd
  return getPlanByLookupKey(`${plan}_monthly`)?.priceMonthlyUsd ?? 0
}

// El plan a partir de los límites del entitlement, que es lo único que el hot
// path de mensajes tiene a mano. `messagesPerPeriod` es distinto en cada plan.
export function analyticsPlanOfLimits(
  isFree: boolean,
  limits: PlanLimits | null
): AnalyticsPlan {
  if (isFree || !limits) return "free"
  const plan = PLANS.find(
    (candidate) =>
      candidate.limits.messagesPerPeriod === limits.messagesPerPeriod
  )
  return analyticsPlanOf(plan?.lookupKey)
}
