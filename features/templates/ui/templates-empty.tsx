import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

// Vacío de `/templates`: sin números de WhatsApp o sin plantillas en la WABA.
// Mismo dibujo que el vacío del Inbox, pero dentro de una tarjeta porque la
// pantalla va con el padding de la consola y no a sangre completa.
export function TemplatesEmpty({
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
    <section className="flex flex-col items-center justify-center gap-3.5 rounded-2xl border border-border bg-surface-sunken px-6 py-14 text-center">
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
    </section>
  )
}
