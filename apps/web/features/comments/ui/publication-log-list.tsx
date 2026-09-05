import Link from "next/link"
import { ImageIcon, TriangleAlert } from "lucide-react"

import type { AppDict } from "@/content/i18n/app"
import { LogContent } from "@/features/messages/ui/conversation-log-list"
import type { PublicationRowView } from "@/lib/comments/display"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

// Filas de publicaciones, gemelas de `ConversationLogList`: mismo bloque con
// scroll, misma densidad y mismos tres renglones, porque las dos son el mismo
// log visto por distinto sujeto (mock 1i). Lo que cambia es qué identifica a
// la fila: en un DM es el contacto, y acá es la publicación —un comentario
// fuera de su post no dice nada— con el total al pie como segunda señal de
// cuánto hay adentro. La cuenta no va en la fila: vive en la cabecera del hilo
// y en el filtro.

export function PublicationLogList({
  rows,
  selectedKey,
  selectedAccountId,
  t,
}: {
  rows: PublicationRowView[]
  selectedKey: string | null
  selectedAccountId: string | null
  t: AppDict
}) {
  return (
    <div className="mt-2.5 flex min-h-0 flex-1 flex-col border-t border-border-subtle">
      <h2 className="sr-only">{t.inbox.publicationsHeading}</h2>
      {rows.length === 0 ? (
        // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          {selectedAccountId
            ? t.inbox.emptyCommentsFiltered
            : t.inbox.emptyComments}
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {rows.map((row) => (
            <PublicationRow
              key={row.key}
              row={row}
              active={row.key === selectedKey}
              selectedAccountId={selectedAccountId}
              t={t}
            />
          ))}
        </ScrollArea>
      )}
    </div>
  )
}

function PublicationRow({
  row,
  active,
  selectedAccountId,
  t,
}: {
  row: PublicationRowView
  active: boolean
  selectedAccountId: string | null
  t: AppDict
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
        "flex gap-3 border-b border-l-2 border-border-subtle px-4 py-3.5 transition-colors",
        active
          ? "border-l-foreground bg-muted"
          : "border-l-transparent hover:bg-surface-sunken"
      )}
    >
      {/* Miniatura de la publicación. Graph no nos da `media_url` todavía, así
          que es un placeholder del tamaño del mock para que la fila no cambie
          de forma el día que llegue. */}
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-border text-muted-foreground"
        aria-hidden
      >
        <ImageIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {/* El caption de la publicación no va en mono: es prosa, no un id.
              El enlace al post vive en la cabecera del hilo y no acá, porque
              la fila entera ya es un enlace y no se pueden anidar. */}
          <p
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-[13.5px] leading-snug font-medium",
              row.failed && "text-[var(--danger-text)]"
            )}
          >
            {row.failed ? (
              <TriangleAlert className="size-3 shrink-0" aria-hidden />
            ) : null}
            <span className="truncate">{row.mediaLabel}</span>
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
            "mt-[3px] truncate text-[13px]",
            row.failed ? "text-[var(--danger-text)]" : "text-[var(--text-body)]"
          )}
        >
          <LogContent content={row.content} t={t} />
        </p>
        <p className="mt-1.5 truncate font-mono text-[10.5px] text-muted-foreground">
          {row.countLabel}
        </p>
      </div>
    </Link>
  )
}
