import type { ReactNode } from "react"

// Cabecera del hilo (mock `1h`/`1i`): 52px, alineada con la del panel de
// lista, título en HK, píldora del canal o del tipo de publicación, y la
// cuenta en mono detrás de un punto medio. El hueco de la derecha lo llena
// cada modo: Comentarios pone «Abrir en Instagram»; Mensajes lo deja vacío
// (deuda declarada en la ADR 0018).
export function ThreadHeader({
  title,
  pill,
  account,
  action,
}: {
  title: string
  pill: ReactNode
  account: string
  action?: ReactNode
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-card px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="truncate font-heading text-[15px] font-semibold">
          {title}
        </h2>
        {pill}
        <span className="truncate font-mono text-[11.5px] text-[var(--text-subtle)]">
          · {account}
        </span>
      </div>
      {action}
    </header>
  )
}
