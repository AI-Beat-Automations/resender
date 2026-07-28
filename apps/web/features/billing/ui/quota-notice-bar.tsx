import Link from "next/link"

// Barra de aviso de cuota, global en el dashboard (ADR 0003): quien no entra a
// `/connections` no se enteraría del límite. v2 no la dibuja (spec C.4), pero
// la ADR 0005 la conserva como franja al ancho del `main`, con los tokens
// semánticos del DS. Presentacional: la decisión de nivel viene resuelta desde
// `lib/billing/entitlements.ts`.

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
// propio texto en español a partir del código de bloqueo (ADR 0005).
function restrictedMessage(notice: QuotaNoticeView): string {
  switch (notice.blockCode) {
    case "page_limit_exceeded":
      return `Tu plan permite ${formatCount(notice.maxPages)} páginas conectadas y tienes ${formatCount(notice.activePageCount)}. Desconecta páginas para volver a enviar.`
    case "quota_exceeded":
      return `Agotaste los ${formatCount(notice.limit)} mensajes de tu plan en este período de facturación. Sube de plan para volver a enviar.`
    case "plan_unavailable":
      return "No pudimos resolver los límites de tu plan. No se arregla desde tu cuenta: lo revisamos nosotros."
    default:
      return "Tu cuenta dejó de enviar mensajes. Revisa tu suscripción para reanudarla."
  }
}

export function QuotaNoticeBar({ notice }: { notice: QuotaNoticeView | null }) {
  if (!notice) return null

  const restricted = notice.level === "restricted"
  // Regla del DS: el tinte suave siempre lleva su borde.
  const tone = restricted
    ? "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground"
    : "border-warning-soft-border bg-warning-soft text-warning-soft-foreground"

  return (
    <div
      className={`flex flex-col gap-1 border-b px-9 py-3 text-[13.5px] leading-[1.55] sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${tone}`}
    >
      <p>
        <span className="font-semibold">
          {restricted
            ? "Cuenta restringida."
            : "Te estás acercando a tu límite."}
        </span>{" "}
        {restricted
          ? restrictedMessage(notice)
          : `Llevas ${formatCount(notice.usage)} de los ${formatCount(notice.limit)} mensajes de tu plan en este período de facturación.`}
      </p>
      {notice.blockCode === "page_limit_exceeded" ? (
        <Link href="/connections" className={ctaClassName}>
          Administrar páginas
        </Link>
      ) : notice.blockCode === "plan_unavailable" ? (
        // Este bloqueo no se arregla pagando: es una inconsistencia de datos
        // nuestra, así que la salida es soporte y no la pestaña de plan.
        <a href="mailto:info@resender.dev" className={ctaClassName}>
          Escríbenos
        </a>
      ) : (
        // A la pestaña de Suscripción, no a Ajustes a secas: un usuario
        // bloqueado no debe aterrizar en Cuenta (ADR 0005).
        <Link href="/settings?tab=suscripcion" className={ctaClassName}>
          Subir de plan
        </Link>
      )}
    </div>
  )
}

const ctaClassName =
  "font-medium whitespace-nowrap underline underline-offset-4"

function formatCount(value: number | null): string {
  if (value === null) return "—"
  return value.toLocaleString("es-ES")
}
