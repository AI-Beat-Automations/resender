import Link from "next/link"
import {
  CircleDashed,
  Clapperboard,
  ImageIcon,
  Megaphone,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"

import type { AppDict } from "@/content/i18n/app"
import type { MediaKind, PublicationRowView } from "@/lib/comments/display"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import { cn } from "@workspace/ui/lib/utils"

// Lista de publicaciones (mock `1i`, ADR 0018), gemela de
// `ConversationLogList`: misma densidad y mismos tres renglones, porque las
// dos son el mismo log visto por distinto sujeto. Lo que cambia es qué
// identifica a la fila: en un DM es el contacto, y acá es la publicación —un
// comentario fuera de su post no dice nada— con el total como segunda señal.
//
// La miniatura es un placeholder con el icono del tipo de post: el webhook no
// trae `thumbnail_url` y traerlo de Graph es deuda declarada en la ADR 0018.

const MEDIA_ICONS: Record<MediaKind, LucideIcon> = {
  feed: ImageIcon,
  reels: Clapperboard,
  story: CircleDashed,
  ad: Megaphone,
}

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
  if (rows.length === 0) {
    // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
    return (
      <p className="px-4 py-5 text-[13px] text-muted-foreground">
        {selectedAccountId
          ? t.inbox.emptyCommentsFiltered
          : t.inbox.emptyComments}
      </p>
    )
  }

  return (
    <ul>
      {rows.map((row) => (
        <li key={row.key}>
          <PublicationRow
            row={row}
            active={row.key === selectedKey}
            selectedAccountId={selectedAccountId}
          />
        </li>
      ))}
    </ul>
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
  const Icon = MEDIA_ICONS[row.mediaKind]

  return (
    <Link
      href={inboxHref({
        tab: "comentarios",
        pageId: selectedAccountId,
        publicationKey: row.key,
      })}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex gap-3 border-b border-l-2 border-border-faint px-4 py-3.5 transition-colors",
        active
          ? "border-l-primary bg-muted"
          : "border-l-transparent hover:bg-muted/50"
      )}
    >
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-border text-muted-foreground"
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium",
              row.failed && "text-[var(--danger-text)]"
            )}
          >
            {row.failed ? (
              <TriangleAlert className="size-3 shrink-0" aria-hidden />
            ) : null}
            <span className="truncate">{row.mediaTitle}</span>
          </p>
          <time
            dateTime={row.timestampIso}
            className="shrink-0 font-mono text-[10.5px] text-[var(--text-subtle)]"
          >
            {row.timestamp}
          </time>
        </div>
        <p
          className={cn(
            "mt-[3px] truncate text-[13px]",
            row.failed ? "text-[var(--danger-text)]" : "text-text-secondary"
          )}
        >
          {row.content}
        </p>
        <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
          {row.countLabel}
        </p>
      </div>
    </Link>
  )
}
