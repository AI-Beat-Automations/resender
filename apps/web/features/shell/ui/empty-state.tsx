import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

// Panel punteado de «todavía no hay nada» (ADR 0015, mock 1f). Es distinto de
// `EmptyPane` de Inbox: aquel llena una columna entera con fondo de app; este
// es un bloque dentro del flujo de la pantalla, con borde discontinuo, que
// admite una fila de pasos o una acción debajo del texto.
export function EmptyState({
  title,
  body,
  children,
  className,
}: {
  title: string
  body: string
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border-strong p-10 text-center",
        className
      )}
    >
      <div className="max-w-[440px]">
        <h2 className="font-heading text-[17px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <p className="mt-1.5 text-[13.5px]/[1.6] text-muted-foreground">
          {body}
        </p>
      </div>
      {children}
    </section>
  )
}
