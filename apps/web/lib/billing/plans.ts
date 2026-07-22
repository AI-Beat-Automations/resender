// Los 3 planes mensuales. El código referencia los lookup keys de Stripe,
// nunca price IDs: así test mode y live comparten código y renombrar
// products/prices en el Dashboard no rompe nada.
export const PLAN_LOOKUP_KEYS = [
  "starter_monthly",
  "pro_monthly",
  "business_monthly",
] as const

export type PlanLookupKey = (typeof PLAN_LOOKUP_KEYS)[number]

export type Plan = {
  lookupKey: PlanLookupKey
  name: string
  priceMonthlyUsd: number
}

export const PLANS: Plan[] = [
  { lookupKey: "starter_monthly", name: "Starter", priceMonthlyUsd: 15 },
  { lookupKey: "pro_monthly", name: "Pro", priceMonthlyUsd: 25 },
  { lookupKey: "business_monthly", name: "Business", priceMonthlyUsd: 60 },
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
