export const PLAN_LIMITS = {
  starter_monthly: { messagesPerPeriod: 50_000, maxPages: 2 },
  pro_monthly: { messagesPerPeriod: 100_000, maxPages: 5 },
} as const

export type CanonicalPlanLookupKey = keyof typeof PLAN_LIMITS

export type EntitlementBlockCode =
  | "quota_exceeded"
  | "page_limit_exceeded"
  | "plan_unavailable"

export type EntitlementNoticeLevel = "warning" | "blocked" | null

export type Entitlement = {
  priceLookupKey: CanonicalPlanLookupKey | null
  periodStart: Date | null
  usage: number
  activePageCount: number
  limits: { messagesPerPeriod: number; maxPages: number } | null
  blockCode: EntitlementBlockCode | null
}

const QUOTA_WARNING_RATIO = 0.8

export function isCanonicalPlanLookupKey(
  value: string
): value is CanonicalPlanLookupKey {
  return Object.hasOwn(PLAN_LIMITS, value)
}

export function evaluateEntitlement(input: {
  priceLookupKey: string | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  usage: number
  activePageCount: number
  now?: Date
}): Entitlement {
  const now = input.now ?? new Date()
  const canonicalKey =
    input.priceLookupKey && isCanonicalPlanLookupKey(input.priceLookupKey)
      ? input.priceLookupKey
      : null
  const limits = canonicalKey ? PLAN_LIMITS[canonicalKey] : null
  const periodStart =
    input.currentPeriodStart &&
    (!input.currentPeriodEnd ||
      input.currentPeriodEnd.getTime() > now.getTime())
      ? input.currentPeriodStart
      : null

  let blockCode: EntitlementBlockCode | null = null
  if (!limits || !periodStart) blockCode = "plan_unavailable"
  else if (input.activePageCount > limits.maxPages) {
    blockCode = "page_limit_exceeded"
  } else if (input.usage >= limits.messagesPerPeriod) {
    blockCode = "quota_exceeded"
  }

  return {
    priceLookupKey: canonicalKey,
    periodStart,
    usage: input.usage,
    activePageCount: input.activePageCount,
    limits,
    blockCode,
  }
}

export function entitlementHttpError(blockCode: EntitlementBlockCode): {
  status: 402 | 403
  message: string
} {
  if (blockCode === "quota_exceeded") {
    return {
      status: 402,
      message:
        "The message quota for the current billing period is exhausted. Upgrade your plan to resume sending.",
    }
  }
  if (blockCode === "page_limit_exceeded") {
    return {
      status: 403,
      message:
        "The account has more active Pages than its plan allows. Disconnect Pages to resume sending.",
    }
  }
  return {
    status: 403,
    message:
      "The plan or billing period is unavailable. Contact support at info@resender.dev.",
  }
}

export function entitlementNoticeLevel(
  entitlement: Entitlement
): EntitlementNoticeLevel {
  if (entitlement.blockCode) return "blocked"
  if (
    entitlement.limits &&
    entitlement.usage / entitlement.limits.messagesPerPeriod >=
      QUOTA_WARNING_RATIO
  ) {
    return "warning"
  }
  return null
}
