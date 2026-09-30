// Cálculo del estimador público de costos de Meta (/whatsapp-cost-calculator).
// Función pura: volúmenes mensuales y un mercado entran, el desglose sale.
//
// Supone un solo número de WhatsApp: el [Cupo gratis de Meta] es por número y
// solo cubre servicio; marketing y utilidad se cobran desde el primer envío
// (ADR 0024).

import { META_FREE_SERVICE_MESSAGES_PER_MONTH } from "@/lib/meta/whatsapp-free-tier"
import type {
  MetaMarketRate,
  MetaMessageCategory,
} from "@/lib/meta/whatsapp-rate-card"

export type MonthlyVolumes = Record<MetaMessageCategory, number>

export type CategoryEstimate = {
  sent: number
  /** Los que entran en el cupo gratis; siempre 0 fuera de servicio. */
  free: number
  billed: number
  rate: number
  cost: number
}

export type CostEstimate = {
  byCategory: Record<MetaMessageCategory, CategoryEstimate>
  total: number
}

const CATEGORIES: readonly MetaMessageCategory[] = [
  "marketing",
  "utility",
  "service",
]

function sanitize(volume: number): number {
  return Number.isFinite(volume) && volume > 0 ? Math.floor(volume) : 0
}

export function estimateMetaCost(
  volumes: MonthlyVolumes,
  market: MetaMarketRate
): CostEstimate {
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => {
      const sent = sanitize(volumes[category])
      const free =
        category === "service"
          ? Math.min(sent, META_FREE_SERVICE_MESSAGES_PER_MONTH)
          : 0
      const billed = sent - free
      const rate = market[category]
      return [category, { sent, free, billed, rate, cost: billed * rate }]
    })
  ) as Record<MetaMessageCategory, CategoryEstimate>

  const total = CATEGORIES.reduce((sum, c) => sum + byCategory[c].cost, 0)
  return { byCategory, total }
}
