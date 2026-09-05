import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import type { AppDict } from "@/content/i18n/app"
import type { PublicationRowView } from "@/lib/comments/display"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import { Card } from "@workspace/ui/components/card"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

// Lista de publicaciones, gemela de `ConversationLogList`: misma `Card` de
// 360 px, misma densidad y mismos tres renglones, porque las dos son el mismo
// log visto por distinto sujeto (ADR 0015, mock 1i). Lo que cambia es qué
// identifica a la fila: en un DM es el contacto, y acá es la publicación —un
// comentario fuera de su post no dice nada— con el total al pie como segunda
// señal de cuánto hay adentro.

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
    <Card className="w-[360px] shrink-0 gap-0 py-0">
      <h2 className="sr-only">{t.inbox.publicationsHeading}</h2>
      {rows.length === 0 ? (
        // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
        <p className="px-4 py-5 text-[13.5px] text-muted-foreground">
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
            />
          ))}
        </ScrollArea>
      )}
    </Card>
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
        "block border-b border-l-2 border-border px-4 py-3.5 transition-colors",
        active
          ? "border-l-primary bg-accent"
          : "border-l-transparent hover:bg-muted/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* El caption de la publicación no va en mono: es prosa, no un id. El
            enlace al post vive en la cabecera del hilo y no acá, porque la fila
            entera ya es un enlace y no se pueden anidar. */}
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
          "mt-1 truncate text-[13px]",
          row.failed ? "text-[var(--danger-text)]" : "text-muted-foreground"
        )}
      >
        {row.content}
      </p>
      <p className="mt-2 truncate font-mono text-[10.5px] text-muted-foreground">
        {row.countLabel} · {row.accountLabel}
      </p>
    </Link>
  )
}
