import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import type { AppDict } from "@/content/i18n/app"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import type { ConversationRowView } from "@/lib/messages/display"
import { Card } from "@workspace/ui/components/card"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

// Lista de conversaciones como LOG, no como bandeja (ADR 0005): sin avatar de
// iniciales. Columna de 360 px en `Card` con `ScrollArea` (ADR 0015, mock 1h):
// identificador arriba, último mensaje debajo —con `Tú: ` cuando es respuesta,
// que ya viene en `content`— y canal + cuenta al pie. El identificador es el
// @handle desde la migración 0014; el `psid …` es la caída y va en mono porque
// es un id, no un nombre.

export function ConversationLogList({
  rows,
  selectedConversationId,
  selectedAccountId,
  t,
}: {
  rows: ConversationRowView[]
  selectedConversationId: string | null
  selectedAccountId: string | null
  t: AppDict
}) {
  return (
    <Card className="w-[360px] shrink-0 gap-0 py-0">
      <h2 className="sr-only">{t.inbox.conversationsHeading}</h2>
      {rows.length === 0 ? (
        // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
        <p className="px-4 py-5 text-[13.5px] text-muted-foreground">
          {selectedAccountId
            ? t.inbox.emptyConversationsFiltered
            : t.inbox.emptyConversations}
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {rows.map((row) => (
            <ConversationRow
              key={row.id}
              row={row}
              active={row.id === selectedConversationId}
              selectedAccountId={selectedAccountId}
              t={t}
            />
          ))}
        </ScrollArea>
      )}
    </Card>
  )
}

function ConversationRow({
  row,
  active,
  selectedAccountId,
  t,
}: {
  row: ConversationRowView
  active: boolean
  selectedAccountId: string | null
  t: AppDict
}) {
  // `psid …` es la caída sin @handle: mono porque es un identificador crudo.
  const rawId = !row.contactLabel.startsWith("@")

  return (
    <Link
      href={inboxHref({
        tab: "mensajes",
        pageId: selectedAccountId,
        conversationId: row.id,
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
        <p
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-[13.5px] leading-snug font-medium",
            rawId && "font-mono text-[12.5px]",
            row.failed && "text-[var(--danger-text)]"
          )}
        >
          {row.failed ? (
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
          ) : null}
          <span className="truncate">{row.contactLabel}</span>
          {row.contactName ? (
            <span className="truncate font-sans text-[12px] font-normal text-muted-foreground">
              · {row.contactName}
            </span>
          ) : null}
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
          row.failed
            ? "text-[var(--danger-text)]"
            : row.hasMessages
              ? "text-muted-foreground"
              : "text-muted-foreground italic"
        )}
      >
        {row.content}
      </p>
      <p className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
        <ChannelBadge channel={row.channel} t={t} />
        <span className="truncate">{row.pageLabel}</span>
      </p>
    </Link>
  )
}
