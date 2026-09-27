import { ExternalLink } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { fmt, type AppDict } from "@/content/i18n/app"
import { META_WHATSAPP_PRICING_URL } from "@/lib/meta/whatsapp-billing-links"
import type {
  MetaFreeTierState,
  MetaFreeTierView,
} from "@/lib/meta/whatsapp-free-tier"

// La barra del [Cupo gratis de Meta] en la tarjeta de WhatsApp (issue #171).
// Es consumo de **Meta**, que Meta factura directo al cliente: por eso el
// título, la línea de abajo y el enlace hablan de Meta, y nada acá se parece
// al contador de cuota del plan del header. La ven el padre y el cliente; no
// muestra ningún precio de Resender.

const TONE: Record<MetaFreeTierState, "neutral" | "warning" | "destructive"> = {
  within: "neutral",
  near: "warning",
  charged: "destructive",
}

export function MetaFreeTierPanel({
  usage,
  t,
}: {
  usage: MetaFreeTierView | "unavailable"
  t: AppDict
}) {
  const copy = t.metaFreeTier

  return (
    <div className="rounded-[10px] border border-border bg-surface-sunken px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] font-medium">
          {copy.title}{" "}
          {/* El mes se corta en UTC y Meta lo corta en la zona de la WABA. */}
          <span
            title={copy.approxHint}
            className="cursor-help font-mono text-[11px] font-normal text-[var(--text-subtle)] underline decoration-dotted underline-offset-2"
          >
            {copy.approx}
          </span>
        </p>
        <a
          href={META_WHATSAPP_PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          {copy.pricingLink}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      {usage === "unavailable" ? (
        <p className="mt-1.5 text-[12.5px]/[1.55] text-muted-foreground">
          {copy.unavailable}
        </p>
      ) : (
        <MetaFreeTierUsage usage={usage} t={t} />
      )}

      <p className="mt-2 text-[12px]/[1.55] text-[var(--text-subtle)]">
        {copy.explainer}
      </p>
    </div>
  )
}

function MetaFreeTierUsage({
  usage,
  t,
}: {
  usage: MetaFreeTierView
  t: AppDict
}) {
  const copy = t.metaFreeTier
  const number = new Intl.NumberFormat(t.intl)
  const freeUsed = fmt(copy.freeUsed, {
    used: number.format(usage.freeUsed),
    limit: number.format(usage.freeLimit),
  })
  const limit = number.format(usage.freeLimit)

  return (
    <>
      {/* Con cupo, el dato es cuánto lleva; agotado, cuánto le cobran. */}
      <p className="mt-1.5 font-mono text-[12.5px] text-foreground">
        {usage.state === "charged"
          ? fmt(copy.billed, { billed: number.format(usage.billedCount) })
          : freeUsed}
      </p>
      <Progress
        className="mt-2"
        value={usage.freeUsed}
        max={usage.freeLimit}
        tone={TONE[usage.state]}
        aria-label={freeUsed}
      />
      {usage.state === "near" && (
        <p className="mt-2 text-[12.5px]/[1.55] text-[var(--warning-text)]">
          {fmt(copy.nearHint, { limit })}
        </p>
      )}
      {usage.state === "charged" && (
        <p className="mt-2 text-[12.5px]/[1.55] text-[var(--danger-text)]">
          {fmt(copy.exhausted, { limit })}
        </p>
      )}
    </>
  )
}
