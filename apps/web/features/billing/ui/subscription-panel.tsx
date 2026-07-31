import Link from "next/link"
import { ExternalLink } from "lucide-react"

import { openPortal } from "@/features/billing/actions"
import {
  SettingsCard,
  SettingsCardTitle,
  SettingsDataRow,
} from "@/features/settings/ui/settings-card"
import { resolveQuotaBar } from "@/features/billing/quota-bar"
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
}: {
  subscription: SubscriptionView | null
}) {
  if (!subscription) {
    return (
      <SettingsCard>
        <div className="flex items-center justify-between gap-3">
          <SettingsCardTitle>Suscripción</SettingsCardTitle>
          <Badge variant="ghost">sin suscripción</Badge>
        </div>
        <p className="mt-3 text-[13.5px]/[1.6] text-muted-foreground">
          No hay ninguna suscripción registrada para esta cuenta.
        </p>
        <Button asChild size="lg" className="mt-4">
          <Link href="/billing">Elegir un plan</Link>
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
        <SettingsCardTitle>Suscripción</SettingsCardTitle>
        {/* En minúscula y en inglés: es el valor literal de
            `subscription.status` (spec C.1). */}
        <Badge variant={statusBadgeVariant(subscription.status)}>
          {subscription.status}
        </Badge>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        <SettingsDataRow label="plan" labelWidth={92}>
          <span className="text-[13.5px]">
            {subscription.planName}
            {subscription.planPriceMonthlyUsd !== null
              ? ` · $${subscription.planPriceMonthlyUsd} / mes`
              : null}
          </span>
        </SettingsDataRow>
        {subscription.currentPeriodEnd ? (
          // Con la cancelación programada la fecha es la del corte, no la de
          // una renovación que no va a ocurrir.
          <SettingsDataRow
            label={subscription.cancelAtPeriodEnd ? "cancela" : "renueva"}
            labelWidth={92}
          >
            <span className="text-[13.5px]">
              {formatDate(subscription.currentPeriodEnd)}
            </span>
          </SettingsDataRow>
        ) : null}
        <SettingsDataRow label="páginas" labelWidth={92}>
          {/* Contador, no barra: una barra para «2 de 5» es ruido
              (ADR 0005). */}
          <span className="font-mono text-[12.5px]">
            {formatCount(subscription.pagesInUse)} /{" "}
            {formatCount(subscription.pageLimit)}
          </span>
        </SettingsDataRow>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13.5px]">Mensajes de este período</span>
          {bar.available ? (
            <span className="font-mono text-[12.5px] text-muted-foreground">
              {formatCount(bar.usage)} / {formatCount(bar.limit)}
            </span>
          ) : null}
        </div>
        {bar.available ? (
          <Progress
            className="mt-2"
            value={bar.percentage}
            max={100}
            tone={bar.tone}
            aria-label="Consumo de mensajes del período"
          />
        ) : (
          // Sin límite resuelto no hay barra: una barra vacía sugeriría cuota
          // libre cuando en realidad el plan no se pudo resolver (ADR 0005).
          <p className="mt-2 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3.5 py-3 text-[13px]/[1.55] text-destructive-soft-foreground">
            No pudimos resolver los límites de tu plan, así que no podemos
            mostrarte el consumo. Escríbenos a{" "}
            <a
              href="mailto:info@resender.dev"
              className="font-medium underline underline-offset-4"
            >
              info@resender.dev
            </a>
            .
          </p>
        )}
      </div>

      <form action={openPortal} className="mt-4">
        <Button type="submit" variant="outline" size="lg">
          <ExternalLink className="size-[15px]" aria-hidden />
          Administrar suscripción
        </Button>
      </form>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Cambia de plan, actualiza tu método de pago o cancela en el portal de
        clientes de Stripe.
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

function formatCount(value: number | null): string {
  if (value === null) return "—"
  return value.toLocaleString("es-ES")
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}
