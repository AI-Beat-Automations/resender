import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

// Panel derecho vacío de Inbox, sobre la misma superficie hundida que
// ocuparía el hilo (mock 1h/1i). Lo comparten los dos modos: el vacío de un
// log dice siempre lo mismo —qué falta y qué lo va a llenar—, y tenerlo dos
// veces garantizaba que uno de los dos se quedara viejo.
export function EmptyPane({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3.5 bg-surface-sunken p-10 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <Icon className="size-[22px]" />
      </span>
      <div className="max-w-[400px]">
        <h2 className="font-heading text-[18px] font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      {action}
    </div>
  )
}
