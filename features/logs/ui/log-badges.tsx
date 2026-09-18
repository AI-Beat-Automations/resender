import { ArrowDownLeft, ArrowUpRight } from "lucide-react"

import type {
  RequestLogDirection,
  RequestLogStatus,
} from "@/lib/logs/request-log"
import { cn } from "@/lib/utils"

// Las tres marcas de una fila (mock `1o`): estado como punto + palabra, sin
// fondo; código HTTP como chip mono; canal como píldora con borde. El sheet
// repite el estado como píldora rellena.

const STATUS_DOT: Record<RequestLogStatus, string> = {
  success: "bg-success",
  failed: "bg-destructive",
  retrying: "bg-warning",
  skipped: "bg-[var(--text-subtle)]",
}

const STATUS_TEXT: Record<RequestLogStatus, string> = {
  success: "text-success-text",
  failed: "text-destructive-soft-foreground",
  retrying: "text-warning-text",
  skipped: "text-muted-foreground",
}

const STATUS_PILL: Record<RequestLogStatus, string> = {
  success: "border-success-soft-border bg-success-soft",
  failed: "border-destructive-soft-border bg-destructive-soft",
  retrying: "border-warning-soft-border bg-warning-soft",
  skipped: "border-border bg-muted",
}

export function LogStatus({
  status,
  pill = false,
}: {
  status: RequestLogStatus
  pill?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px]",
        STATUS_TEXT[status],
        pill && "rounded-full border px-[9px] py-[3px]",
        pill && STATUS_PILL[status]
      )}
    >
      <span
        className={cn("size-[7px] shrink-0 rounded-full", STATUS_DOT[status])}
        aria-hidden
      />
      {status}
    </span>
  )
}

export function LogHttpCode({ code }: { code: number | null }) {
  if (code === null) {
    return <span className="font-mono text-[11.5px] text-muted-foreground">—</span>
  }
  const ok = code >= 200 && code < 400
  return (
    <span
      className={cn(
        "rounded-[5px] px-1.5 py-px font-mono text-[11.5px]",
        ok
          ? "bg-success-soft text-success-soft-foreground"
          : "bg-destructive-soft text-destructive-soft-foreground"
      )}
    >
      {code}
    </span>
  )
}

export function LogChannel({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11.5px] text-text-secondary">
      {label}
    </span>
  )
}

// Lo que entra a Resender (de Meta o del bot) baja a la izquierda; lo que sale
// hacia el bot sube a la derecha. Mismo par de flechas que el mock.
export function LogDirection({
  direction,
  label,
}: {
  direction: RequestLogDirection
  label: string
}) {
  const Icon = direction === "resender_to_bot" ? ArrowUpRight : ArrowDownLeft
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px]">
      <Icon className="size-[13px] shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  )
}

export function LogEndpoint({
  method,
  endpoint,
  wrap = false,
}: {
  method: string
  endpoint: string
  wrap?: boolean
}) {
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1.5 font-mono")}>
      <span
        className={cn(
          "shrink-0 text-[10.5px] font-bold",
          method === "GET" ? "text-muted-foreground" : "text-primary"
        )}
      >
        {method}
      </span>
      <span className={cn("text-[12px]", wrap ? "break-all" : "truncate")}>
        {endpoint}
      </span>
    </span>
  )
}
