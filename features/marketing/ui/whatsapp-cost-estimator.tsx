"use client"

import { useEffect, useState } from "react"
import { usePostHog } from "posthog-js/react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { WhatsappChatMock } from "@/features/marketing/ui/whatsapp-chat-mock"
import {
  estimateMetaCost,
  type MonthlyVolumes,
} from "@/lib/meta/whatsapp-cost-estimate"
import {
  DEFAULT_MARKET_ID,
  META_MARKET_RATES,
  META_RATE_CARD_EFFECTIVE_DATE,
  META_WHATSAPP_PRICING_URL,
  findMarket,
  type MetaMessageCategory,
} from "@/lib/meta/whatsapp-rate-card"
import { isPostHogEnabled } from "@/lib/posthog-client"
import type { Dict, Locale } from "@/content/i18n"

// Las secciones interactivas de /whatsapp-cost-calculator: los tres tipos de
// mensaje y la calculadora. Van juntas porque comparten el país elegido: el
// precio de cada mockup es el del mercado seleccionado en la calculadora.

const CATEGORIES: readonly MetaMessageCategory[] = [
  "marketing",
  "utility",
  "service",
]

// Valores de ejemplo: servicio pasa del cupo para que el resultado muestre el
// descuento de los 1.000 gratis desde el principio.
const INITIAL_VOLUMES: MonthlyVolumes = {
  marketing: 500,
  utility: 1000,
  service: 3000,
}

// El resultado se recalcula en cada tecla: `calculator used` sale cuando la
// persona deja de tocar los campos, no por cada dígito.
const CALCULATOR_EVENT_DELAY_MS = 1500

function formatters(lang: Locale) {
  // es-AR y no es-419: agrupa miles con punto («2.000»), igual que el copy.
  const locale = lang === "es" ? "es-AR" : "en-US"
  return {
    count: new Intl.NumberFormat(locale),
    // Las tarifas llegan a diezmilésimas de dólar ($0.0008).
    rate: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }),
    money: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      currencyDisplay: "narrowSymbol",
    }),
    date: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  }
}

// Select de país compartido: los dos del estimador (tipos de mensaje y
// calculadora) leen y escriben el mismo estado.
function MarketSelect({
  id,
  value,
  onChange,
  lang,
}: {
  id: string
  value: string
  onChange: (id: string) => void
  lang: Locale
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      {META_MARKET_RATES.map((option) => (
        <option key={option.id} value={option.id}>
          {option.flag} {option.name[lang]}
        </option>
      ))}
    </select>
  )
}

export function WhatsappCostEstimator({
  lang,
  copy,
}: {
  lang: Locale
  copy: Dict["whatsappCost"]
}) {
  const [marketId, setMarketId] = useState(DEFAULT_MARKET_ID)
  const [volumes, setVolumes] = useState<MonthlyVolumes>(INITIAL_VOLUMES)

  const market = findMarket(marketId)
  const estimate = estimateMetaCost(volumes, market)

  // Solo después de que la persona cambió algo: los valores de ejemplo con
  // los que abre la página no son un uso de la calculadora.
  // Se compara por identidad con el estado inicial y no con un ref de «primer
  // render», que el doble montaje de StrictMode dispararía en dev.
  const posthog = usePostHog()
  useEffect(() => {
    if (marketId === DEFAULT_MARKET_ID && volumes === INITIAL_VOLUMES) return
    if (!isPostHogEnabled) return
    const timer = setTimeout(() => {
      posthog.capture("calculator used", {
        country: marketId,
        messages_per_month: CATEGORIES.reduce(
          (sum, category) => sum + (volumes[category] || 0),
          0
        ),
        marketing_messages: volumes.marketing,
        utility_messages: volumes.utility,
        service_messages: volumes.service,
        estimated_cost_usd: Math.round(estimate.total * 100) / 100,
      })
    }, CALCULATOR_EVENT_DELAY_MS)
    return () => clearTimeout(timer)
    // `estimate` se deriva de `marketId` y `volumes` en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posthog, marketId, volumes])
  const format = formatters(lang)
  const { types, calculator } = copy

  const priceLabel = (category: MetaMessageCategory) => {
    const price = format.rate.format(market[category])
    return category === "service"
      ? types.afterFree.replace("{price}", price)
      : types.perMessage.replace("{price}", price)
  }

  return (
    <>
      <Section>
        <SectionHeading
          kicker={types.kicker}
          title={types.title}
          subtitle={types.subtitle}
        />
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">
          <Label htmlFor="types-market" className="justify-center">
            {types.priceFor}
          </Label>
          <MarketSelect
            id="types-market"
            value={marketId}
            onChange={setMarketId}
            lang={lang}
          />
        </div>
        <div className="mt-12 grid gap-10 lg:grid-cols-3">
          {types.items.map((item) => (
            <div key={item.category} className="flex flex-col gap-5">
              <WhatsappChatMock
                business={types.business}
                chat={item.chat}
                time={item.time}
              />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{item.label}</h3>
                  <Badge variant="outline">{item.kind}</Badge>
                </div>
                <p className="mt-1 font-mono text-sm text-primary">
                  {priceLabel(item.category)}
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="calculator">
        <SectionHeading
          kicker={calculator.kicker}
          title={calculator.title}
          subtitle={calculator.subtitle}
        />
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="market">{calculator.marketLabel}</Label>
                <MarketSelect
                  id="market"
                  value={marketId}
                  onChange={setMarketId}
                  lang={lang}
                />
              </div>
              <fieldset className="space-y-4">
                <legend className="mb-4 text-sm font-medium">
                  {calculator.volumesLabel}
                </legend>
                {CATEGORIES.map((category) => (
                  <div key={category} className="space-y-1.5">
                    <Label htmlFor={`volume-${category}`}>
                      {calculator.categories[category]}
                    </Label>
                    <Input
                      id={`volume-${category}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={100}
                      value={volumes[category] || ""}
                      placeholder="0"
                      onChange={(event) =>
                        setVolumes((current) => ({
                          ...current,
                          [category]: event.target.valueAsNumber || 0,
                        }))
                      }
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      {calculator.hints[category]}
                    </p>
                  </div>
                ))}
              </fieldset>
            </CardContent>
          </Card>

          <Card className="ring-2 ring-primary">
            <CardContent className="flex h-full flex-col">
              <h3 className="text-sm font-medium text-muted-foreground">
                {calculator.resultTitle} · {market.flag} {market.name[lang]}
              </h3>
              <dl className="mt-4 divide-y divide-border">
                {CATEGORIES.map((category) => {
                  const line = estimate.byCategory[category]
                  return (
                    <div key={category} className="py-3">
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="font-medium">
                          {calculator.categories[category]}
                        </dt>
                        <dd className="font-mono">
                          {format.money.format(line.cost)}
                        </dd>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {line.free > 0
                          ? `${calculator.freeApplied.replace("{free}", format.count.format(line.free))} · `
                          : null}
                        {calculator.billedLine
                          .replace("{billed}", format.count.format(line.billed))
                          .replace("{price}", format.rate.format(line.rate))}
                      </p>
                    </div>
                  )
                })}
              </dl>
              <div className="mt-auto flex items-baseline justify-between gap-4 border-t border-border pt-4">
                <span className="font-medium">{calculator.total}</span>
                <span className="font-heading text-3xl font-bold">
                  {format.money.format(estimate.total)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {calculator.perMonth}
                  </span>
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
        <p className="mx-auto mt-6 max-w-4xl text-xs leading-5 text-muted-foreground">
          {calculator.disclaimer.replace(
            "{date}",
            format.date.format(new Date(META_RATE_CARD_EFFECTIVE_DATE))
          )}{" "}
          <a
            href={META_WHATSAPP_PRICING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            {calculator.disclaimerLink}
          </a>
        </p>
      </Section>
    </>
  )
}
