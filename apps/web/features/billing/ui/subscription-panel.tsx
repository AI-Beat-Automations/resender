import Link from "next/link"
import { ExternalLink } from "lucide-react"

import { fmt, type AppDict } from "@/content/i18n/app"
import { openPortal } from "@/features/billing/actions"
import {
  SettingsCard,
  SettingsCardTitle,
  SettingsDataRow,
} from "@/features/settings/ui/settings-card"
import { resolveQuotaBar } from "@/lib/billing/entitlements"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"

export type SubscriptionView = {
  planName: string
  planPriceMonthlyUsd: number | null
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  // Consumo del período vigente contra el límite del plan; `limit` es null
  // cuando el plan no se pudo resolver.
  usage: number
  messageLimit: number | null
  pagesInUse: number
  pageLimit: number | null
}

// B8. Server component: `openPortal` es una server action que se invoca desde
// un `form`, así que la pantalla no necesita cliente.
export function SubscriptionPanel({
  subscription,
  t,
}: {
  subscription: SubscriptionView | null
  t: AppDict
}) {
  if (!subscription) {
    return (
      <SettingsCard>
        <div className="flex items-center justify-between gap-3">
          <SettingsCardTitle>{t.subscription.title}</SettingsCardTitle>
          <Badge variant="ghost">{t.subscription.none}</Badge>
        </div>
        <p className="mt-3 text-[13.5px]/[1.6] text-muted-foreground">
          {t.subscription.noneBody}
        </p>
        <Button asChild size="lg" className="mt-4">
          <Link href="/billing">{t.subscription.choosePlan}</Link>
        </Button>
      </SettingsCard>
    )
  }

  // Mismos umbrales que la franja global de cuota (ADR 0005): el tono sale de
  // `resolveQuotaBar`, no de un porcentaje calculado aquí.
  const bar = resolveQuotaBar({
    usage: subscription.usage,
    limit: subscription.messageLimit,
  })

  return (
    <SettingsCard>
      <div className="flex items-center justify-between gap-3">
        <SettingsCardTitle>{t.subscription.title}</SettingsCardTitle>
        {/* En minúscula y en inglés: es el valor literal de
            `subscription.status` (spec C.1). */}
        <Badge variant={statusBadgeVariant(subscription.status)}>
          {subscription.status}
        </Badge>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        <SettingsDataRow label={t.subscription.planLabel} labelWidth={92}>
          <span className="text-[13.5px]">
            {subscription.planName}
            {subscription.planPriceMonthlyUsd !== null
              ? fmt(t.subscription.perMonth, {
                  price: subscription.planPriceMonthlyUsd,
                })
              : null}
          </span>
        </SettingsDataRow>
        {subscription.currentPeriodEnd ? (
          // Con la cancelación programada la fecha es la del corte, no la de
          // una renovación que no va a ocurrir.
          <SettingsDataRow
            label={
              subscription.cancelAtPeriodEnd
                ? t.subscription.cancelsLabel
                : t.subscription.renewsLabel
            }
            labelWidth={92}
          >
            <span className="text-[13.5px]">
              {formatDate(subscription.currentPeriodEnd, t.intl)}
            </span>
          </SettingsDataRow>
        ) : null}
        <SettingsDataRow
          label={t.subscription.connectionsLabel}
          labelWidth={92}
        >
          {/* Contador, no barra: una barra para «2 de 5» es ruido
              (ADR 0005). */}
          <span className="font-mono text-[12.5px]">
            {formatCount(subscription.pagesInUse, t.intl)} /{" "}
            {formatCount(subscription.pageLimit, t.intl)}
          </span>
        </SettingsDataRow>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13.5px]">{t.subscription.periodMessages}</span>
          {bar.available ? (
            <span className="font-mono text-[12.5px] text-muted-foreground">
              {formatCount(bar.usage, t.intl)} /{" "}
              {formatCount(bar.limit, t.intl)}
            </span>
          ) : null}
        </div>
        {bar.available ? (
          <Progress
            className="mt-2"
            value={bar.percentage}
            max={100}
            tone={bar.tone}
            aria-label={t.subscription.usageAria}
          />
        ) : (
          // Sin límite resuelto no hay barra: una barra vacía sugeriría cuota
          // libre cuando en realidad el plan no se pudo resolver (ADR 0005).
          <p className="mt-2 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3.5 py-3 text-[13px]/[1.55] text-destructive-soft-foreground">
            {t.subscription.limitsUnresolved}{" "}
            <a
              href={`mailto:${t.common.contactEmail}`}
              className="font-medium underline underline-offset-4"
            >
              {t.common.contactEmail}
            </a>
            .
          </p>
        )}
      </div>

      <form action={openPortal} className="mt-4">
        <Button type="submit" variant="outline" size="lg">
          <ExternalLink className="size-[15px]" aria-hidden />
          {t.subscription.managePortal}
        </Button>
      </form>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        {t.subscription.portalHint}
      </p>
    </SettingsCard>
  )
}

// Mapeo estado → badge (spec C.1). Cualquier estado que no sea uno de los tres
// conocidos va en neutro: no inventamos drama para un `incomplete`.
function statusBadgeVariant(
  status: string
): "success" | "warning" | "destructive" | "ghost" {
  if (status === "active") return "success"
  if (status === "past_due") return "warning"
  if (status === "canceled") return "destructive"
  return "ghost"
}

function formatCount(value: number | null, intl: string): string {
  if (value === null) return "—"
  return value.toLocaleString(intl)
}

function formatDate(iso: string, intl: string): string {
  return new Date(iso).toLocaleDateString(intl, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}
