import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import type { PublicationRowView } from "@/lib/comments/display"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import { cn } from "@workspace/ui/lib/utils"

// Lista de publicaciones, gemela de `ConversationLogList`: mismo ancho, misma
// densidad y mismos tres renglones, porque las dos son el mismo log visto por
// distinto sujeto. Lo que cambia es qué identifica a la fila: en un DM es el
// contacto, y acá es la publicación —un comentario fuera de su post no dice
// nada— con el total como segunda señal de cuánto hay adentro.

export function PublicationLogList({
  rows,
  selectedKey,
  selectedAccountId,
}: {
  rows: PublicationRowView[]
  selectedKey: string | null
  selectedAccountId: string | null
}) {
  return (
    <aside className="flex w-[352px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-[18px] py-4">
        <h2 className="font-heading text-[15px] font-semibold">
          Publicaciones
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Ordenadas por actividad reciente.
        </p>
      </div>

      {rows.length === 0 ? (
        // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
        <p className="px-[18px] py-5 text-[13.5px] text-muted-foreground">
          {selectedAccountId
            ? "No hay comentarios para este filtro."
            : "Todavía no hay comentarios."}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((row) => (
            <PublicationRow
              key={row.key}
              row={row}
              active={row.key === selectedKey}
              selectedAccountId={selectedAccountId}
            />
          ))}
        </div>
      )}
    </aside>
  )
}

function PublicationRow({
  row,
  active,
  selectedAccountId,
}: {
  row: PublicationRowView
  active: boolean
  selectedAccountId: string | null
}) {
  return (
    <Link
      href={inboxHref({
        tab: "comentarios",
        pageId: selectedAccountId,
        publicationKey: row.key,
      })}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block border-b border-l-2 border-border px-[18px] py-3.5 transition-colors",
        active
          ? "border-l-primary bg-primary-soft"
          : "border-l-transparent hover:bg-muted/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "flex min-w-0 items-start gap-1.5 text-[13.5px] leading-snug",
            active && "font-medium",
            row.failed && "text-[var(--danger-text)]"
          )}
        >
          {row.failed ? (
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          ) : null}
          <span className="line-clamp-2">{row.content}</span>
        </p>
        <time
          dateTime={row.timestampIso}
          className="shrink-0 pt-0.5 font-mono text-[10.5px] text-[var(--text-subtle)]"
        >
          {row.timestamp}
        </time>
      </div>
      <p
        className={cn(
          "mt-1.5 truncate font-mono text-[10.5px]",
          active ? "text-primary-soft-foreground" : "text-[var(--text-subtle)]"
        )}
      >
        {row.mediaLabel} · {row.countLabel}
      </p>
      <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-subtle)]">
        {row.accountLabel}
      </p>
    </Link>
  )
}
