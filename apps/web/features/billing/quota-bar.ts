export type QuotaBar =
  | { available: false }
  | {
      available: true
      usage: number
      limit: number
      percentage: number
      tone: "neutral" | "warning" | "destructive"
    }

const WARNING_RATIO = 0.8

export function resolveQuotaBar(input: {
  usage: number
  limit: number | null
}): QuotaBar {
  const { usage, limit } = input
  if (!limit || limit <= 0) return { available: false }
  const ratio = usage / limit
  return {
    available: true,
    usage,
    limit,
    percentage: Math.min(Math.max(ratio * 100, 0), 100),
    tone:
      ratio >= 1
        ? "destructive"
        : ratio >= WARNING_RATIO
          ? "warning"
          : "neutral",
  }
}
