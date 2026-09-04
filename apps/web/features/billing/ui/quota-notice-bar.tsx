import Link from "next/link"
import { AlertTriangle, OctagonAlert } from "lucide-react"

import { fmt, type AppDict } from "@/content/i18n/app"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

// Barra de aviso de cuota, global en el dashboard (ADR 0003): quien no entra a
// `/connections` no se enteraría del límite. v2 no la dibuja (spec C.4), pero
// la ADR 0005 la conserva como franja al ancho del `main`; la ADR 0015 la pasa
// a `Alert` de shadcn en variante `warning`/`destructive`. Presentacional: la
// decisión de nivel viene resuelta desde `lib/billing/entitlements.ts`.

export type QuotaNoticeView = {
  level: "warning" | "restricted"
  usage: number
  limit: number | null
  // Motivo de la restricción, cuando la cuenta ya está bloqueada.
  blockCode:
    | "quota_exceeded"
    | "page_limit_exceeded"
    | "plan_unavailable"
    | null
  activePageCount: number
  maxPages: number | null
}

// El `message` de `EntitlementBlock` no se reutiliza aquí a propósito: viaja en
// el cuerpo de los 402/403 de la API externa, que está documentada en inglés
// (`/docs`). Traducirlo cambiaría ese contrato, así que la franja escribe su
// propio texto a partir del código de bloqueo (ADR 0005).
function restrictedMessage(notice: QuotaNoticeView, t: AppDict): string {
  const intl = t.intl
  switch (notice.blockCode) {
    case "page_limit_exceeded":
      return fmt(t.quota.blockedPageLimit, {
        maxPages: formatCount(notice.maxPages, intl),
        activePageCount: formatCount(notice.activePageCount, intl),
      })
    case "quota_exceeded":
      return fmt(t.quota.blockedQuota, {
        limit: formatCount(notice.limit, intl),
      })
    case "plan_unavailable":
      return t.quota.blockedPlanUnavailable
    default:
      return t.quota.blockedDefault
  }
}

export function QuotaNoticeBar({
  notice,
  t,
}: {
  notice: QuotaNoticeView | null
  t: AppDict
}) {
  if (!notice) return null

  const restricted = notice.level === "restricted"
  const Icon = restricted ? OctagonAlert : AlertTriangle

  let cta: React.ReactNode
  if (notice.blockCode === "page_limit_exceeded") {
    cta = <Link href="/connections">{t.quota.ctaManagePages}</Link>
  } else if (notice.blockCode === "plan_unavailable") {
    // Este bloqueo no se arregla pagando: es una inconsistencia de datos
    // nuestra, así que la salida es soporte y no la pestaña de plan.
    cta = <a href={`mailto:${t.common.contactEmail}`}>{t.quota.ctaContact}</a>
  } else {
    // A la pestaña de Suscripción, no a Ajustes a secas: un usuario
    // bloqueado no debe aterrizar en Cuenta (ADR 0005).
    cta = <Link href="/settings?tab=suscripcion">{t.quota.ctaUpgrade}</Link>
  }

  return (
    // Franja, no tarjeta: sin radio ni bordes laterales, solo la línea inferior.
    <Alert
      variant={restricted ? "destructive" : "warning"}
      className="shrink-0 items-center rounded-none border-x-0 border-t-0 px-6 py-2.5 text-[13px] leading-[1.55] has-[>svg]:grid-cols-[auto_1fr_auto] has-[>svg]:gap-x-3 *:[svg]:row-span-1 *:[svg]:translate-y-0"
    >
      <Icon className="size-[15px]" aria-hidden />
      <AlertTitle className="font-normal">
        <span className="font-semibold">
          {restricted ? t.quota.restrictedTitle : t.quota.warningTitle}
        </span>{" "}
        {restricted
          ? restrictedMessage(notice, t)
          : fmt(t.quota.warningBody, {
              usage: formatCount(notice.usage, t.intl),
              limit: formatCount(notice.limit, t.intl),
            })}
      </AlertTitle>
      <Button asChild size="sm" variant="outline" className="whitespace-nowrap">
        {cta}
      </Button>
    </Alert>
  )
}

function formatCount(value: number | null, intl: string): string {
  if (value === null) return "—"
  return value.toLocaleString(intl)
}
