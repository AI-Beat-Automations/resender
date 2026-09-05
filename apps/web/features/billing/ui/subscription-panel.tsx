import Link from "next/link"
import type { ReactNode } from "react"
import { ExternalLink, Info, OctagonAlert } from "lucide-react"

import { fmt, type AppDict } from "@/content/i18n/app"
import { openPortal } from "@/features/billing/actions"
import { SettingsCardHeader } from "@/features/settings/ui/settings-card"
import { resolveQuotaBar } from "@/lib/billing/entitlements"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardFooter } from "@workspace/ui/components/card"
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

// B8 (mock 1l). Server component: `openPortal` es una server action que se
// invoca desde un `form`, así que la pantalla no necesita cliente.
export function SubscriptionPanel({
  subscription,
  t,
}: {
  subscription: SubscriptionView | null
  t: AppDict
}) {
  if (!subscription) {
    return (
      <Card>
        <SettingsCardHeader
          title={t.subscription.title}
          action={<Badge variant="ghost">{t.subscription.none}</Badge>}
        />
        <CardContent className="flex flex-col gap-4">
          {/* `note` y no `alert`: no hay nada roto, solo falta elegir plan. */}
          <Alert role="note">
            <Info aria-hidden />
            <AlertTitle className="font-normal">
              {t.subscription.noneBody}
            </AlertTitle>
          </Alert>
          <Button asChild className="self-start">
            <Link href="/billing">{t.subscription.choosePlan}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Mismos umbrales que la franja global de cuota (ADR 0005): el tono sale de
  // `resolveQuotaBar`, no de un porcentaje calculado aquí.
  const bar = resolveQuotaBar({
    usage: subscription.usage,
    limit: subscription.messageLimit,
  })

  return (
    <Card>
      <SettingsCardHeader
        title={t.subscription.title}
        action={
          // En minúscula y en inglés: es el valor literal de
          // `subscription.status` (spec C.1).
          <Badge variant={statusBadgeVariant(subscription.status)}>
            {subscription.status}
          </Badge>
        }
      />

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t.subscription.planLabel}>
            {subscription.planName}
            {subscription.planPriceMonthlyUsd !== null ? (
              <span className="font-normal text-muted-foreground">
                {fmt(t.subscription.perMonth, {
                  price: subscription.planPriceMonthlyUsd,
                })}
              </span>
            ) : null}
          </Stat>
          {subscription.currentPeriodEnd ? (
            // Con la cancelación programada la fecha es la del corte, no la de
            // una renovación que no va a ocurrir.
            <Stat
              label={
                subscription.cancelAtPeriodEnd
                  ? t.subscription.cancelsLabel
                  : t.subscription.renewsLabel
              }
            >
              {formatDate(subscription.currentPeriodEnd, t.intl)}
            </Stat>
          ) : null}
          {/* Contador, no barra: una barra para «2 de 5» es ruido
              (ADR 0005). */}
          <Stat label={t.subscription.connectionsLabel} mono>
            {formatCount(subscription.pagesInUse, t.intl)} /{" "}
            {formatCount(subscription.pageLimit, t.intl)}
          </Stat>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13.5px]">
              {t.subscription.periodMessages}
            </span>
            {bar.available ? (
              <span className="font-mono text-[12.5px] text-muted-foreground">
                {formatCount(bar.usage, t.intl)} /{" "}
                {formatCount(bar.limit, t.intl)}
              </span>
            ) : null}
          </div>
          {bar.available ? (
            <>
              <Progress
                className="mt-2"
                value={bar.percentage}
                max={100}
                tone={bar.tone}
                aria-label={t.subscription.usageAria}
              />
              <p
                className={
                  bar.tone === "destructive"
                    ? "mt-2 text-[12.5px] text-destructive-soft-foreground"
                    : bar.tone === "warning"
                      ? "mt-2 text-[12.5px] text-warning-soft-foreground"
                      : "mt-2 text-[12.5px] text-muted-foreground"
                }
              >
                {usageHint(bar.tone, bar.percentage, t)}
              </p>
            </>
          ) : (
            // Sin límite resuelto no hay barra: una barra vacía sugeriría cuota
            // libre cuando en realidad el plan no se pudo resolver (ADR 0005).
            <Alert variant="destructive" role="alert" className="mt-2">
              <OctagonAlert aria-hidden />
              <AlertTitle className="font-normal">
                {t.subscription.limitsUnresolved}{" "}
                <a href={`mailto:${t.common.contactEmail}`}>
                  {t.common.contactEmail}
                </a>
                .
              </AlertTitle>
            </Alert>
          )}
        </div>
      </CardContent>

      <CardFooter className="gap-3.5">
        <form action={openPortal} className="shrink-0">
          <Button type="submit" variant="outline">
            <ExternalLink aria-hidden />
            {t.subscription.managePortal}
          </Button>
        </form>
        <p className="text-[12.5px] text-muted-foreground">
          {t.subscription.portalHint}
        </p>
      </CardFooter>
    </Card>
  )
}

// Una de las tres columnas clave/valor (PLAN · RENUEVA · CONEXIONES).
function Stat({
  label,
  mono = false,
  children,
}: {
  label: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border px-3.5 py-3">
      <p className="font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={
          mono
            ? "mt-1.5 font-mono text-[14px] font-medium"
            : "mt-1.5 text-[15px] font-medium"
        }
      >
        {children}
      </p>
    </div>
  )
}

// Texto bajo la barra según el tono que ya decidió `resolveQuotaBar`: neutro
// explica la regla, ámbar avisa el porcentaje, destructivo dice que el envío
// está pausado.
function usageHint(
  tone: "neutral" | "warning" | "destructive",
  percentage: number,
  t: AppDict
): string {
  if (tone === "destructive") return t.subscription.usageBlocked
  if (tone === "warning") {
    return fmt(t.subscription.usageWarning, {
      percent: Math.round(percentage),
    })
  }
  return t.subscription.usageNeutral
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
