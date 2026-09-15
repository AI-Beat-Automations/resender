// Los 3 planes mensuales. El código referencia los lookup keys de Stripe,
// nunca price IDs: así test mode y live comparten código y renombrar
// products/prices en el Dashboard no rompe nada.
// `business_monthly` vuelve (ADR 0016) tras haberse eliminado en la 0003:
// se crea un price nuevo en Stripe con la misma lookup key.
export const PLAN_LOOKUP_KEYS = [
  "starter_monthly",
  "pro_monthly",
  "business_monthly",
] as const

export type PlanLookupKey = (typeof PLAN_LOOKUP_KEYS)[number]

// Límites por plan (ADR 0003). `messagesPerPeriod` cuenta ambas direcciones:
// un entrante persistido suma 1 y una respuesta aceptada por Meta suma 1.
// `maxPages` es el cupo de **conexiones** en estado `active`, sin mirar el
// canal (ADR 0011): una cuenta de Instagram ocupa un slot igual que una Página.
// El nombre se queda como está: el rename a `maxConnections` es deuda declarada.
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
    priceMonthlyUsd: 29,
    limits: { messagesPerPeriod: 100_000, maxPages: 5 },
  },
  {
    lookupKey: "business_monthly",
    name: "Business",
    priceMonthlyUsd: 199,
    limits: { messagesPerPeriod: 1_000_000, maxPages: 40 },
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
