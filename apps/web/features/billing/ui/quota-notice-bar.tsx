import Link from "next/link"

// Barra de aviso de cuota, global en el dashboard (ADR 0003): quien no entra a
// `/connections` no se enteraría del límite. Presentacional: la decisión de
// nivel viene resuelta desde `lib/billing/entitlements.ts`.

export type QuotaNoticeView = {
  level: "warning" | "restricted"
  usage: number
  limit: number | null
  // Motivo de la restricción, cuando la cuenta ya está bloqueada.
  blockCode: "quota_exceeded" | "page_limit_exceeded" | "plan_unavailable" | null
  blockMessage: string | null
}

export function QuotaNoticeBar({ notice }: { notice: QuotaNoticeView | null }) {
  if (!notice) return null

  const restricted = notice.level === "restricted"
  const tone = restricted
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"

  return (
    <div className={`border-b ${tone}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-medium">
            {restricted ? "Account restricted." : "You're close to your limit."}
          </span>{" "}
          {restricted
            ? notice.blockMessage
            : `You used ${formatCount(notice.usage)} of the ${formatCount(notice.limit)} messages of your plan for this billing period.`}
        </p>
        {notice.blockCode === "page_limit_exceeded" ? (
          <Link
            href="/connections"
            className="font-medium underline underline-offset-4"
          >
            Manage Pages
          </Link>
        ) : (
          <Link
            href="/settings"
            className="font-medium underline underline-offset-4"
          >
            Upgrade plan
          </Link>
        )}
      </div>
    </div>
  )
}

function formatCount(value: number | null): string {
  if (value === null) return "—"
  return value.toLocaleString("en-US")
}
