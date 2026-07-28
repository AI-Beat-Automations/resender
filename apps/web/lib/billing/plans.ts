// Los 2 planes mensuales. El código referencia los lookup keys de Stripe,
// nunca price IDs: así test mode y live comparten código y renombrar
// products/prices en el Dashboard no rompe nada.
// `business_monthly` fue eliminado (ADR 0003): su price está archivado en
// Stripe y nunca tuvo suscripciones.
export const PLAN_LOOKUP_KEYS = ["starter_monthly", "pro_monthly"] as const

export type PlanLookupKey = (typeof PLAN_LOOKUP_KEYS)[number]

// Límites por plan (ADR 0003). `messagesPerPeriod` cuenta ambas direcciones:
// un entrante persistido suma 1 y una respuesta aceptada por Meta suma 1.
// `maxPages` cuenta solo las páginas en estado `active`.
export type PlanLimits = {
  messagesPerPeriod: number
  maxPages: number
}

export type Plan = {
  lookupKey: PlanLookupKey
  name: string
  priceMonthlyUsd: number
  limits: PlanLimits
}

export const PLANS: Plan[] = [
  {
    lookupKey: "starter_monthly",
    name: "Starter",
    priceMonthlyUsd: 15,
    limits: { messagesPerPeriod: 50_000, maxPages: 2 },
  },
  {
    lookupKey: "pro_monthly",
    name: "Pro",
    priceMonthlyUsd: 25,
    limits: { messagesPerPeriod: 100_000, maxPages: 5 },
  },
]

export function isPlanLookupKey(value: unknown): value is PlanLookupKey {
  return (
    typeof value === "string" &&
    (PLAN_LOOKUP_KEYS as readonly string[]).includes(value)
  )
}

export function getPlanByLookupKey(lookupKey: string): Plan | null {
  return PLANS.find((plan) => plan.lookupKey === lookupKey) ?? null
}
