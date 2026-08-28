import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import type { AppDict } from "@/content/i18n/app"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import type { ConversationRowView } from "@/lib/messages/display"
import { cn } from "@workspace/ui/lib/utils"

// Lista de conversaciones como LOG, no como bandeja (ADR 0005): sin avatar de
// iniciales y el último mensaje en el renglón principal. El identificador
// secundario es el @handle desde la migración 0014; antes era el PSID crudo
// porque era lo único que había.

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
    <aside className="flex w-[352px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-[18px] py-4">
        <h2 className="font-heading text-[15px] font-semibold">
          {t.inbox.conversationsHeading}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {t.inbox.sortedByActivity}
        </p>
      </div>

      {rows.length === 0 ? (
        // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
        <p className="px-[18px] py-5 text-[13.5px] text-muted-foreground">
          {selectedAccountId
            ? t.inbox.emptyConversationsFiltered
            : t.inbox.emptyConversations}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((row) => (
            <ConversationRow
              key={row.id}
              row={row}
              active={row.id === selectedConversationId}
              selectedAccountId={selectedAccountId}
              t={t}
            />
          ))}
        </div>
      )}
    </aside>
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
  return (
    <Link
      href={inboxHref({
        tab: "mensajes",
        pageId: selectedAccountId,
        conversationId: row.id,
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
            row.failed && "text-[var(--danger-text)]",
            !row.failed && !row.hasMessages && "text-muted-foreground italic"
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
        {row.contactLabel}
        {row.contactName ? (
          <span className="text-[var(--text-subtle)]">
            {" "}
            · {row.contactName}
          </span>
        ) : null}
      </p>
      <p className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--text-subtle)]">
        <ChannelBadge channel={row.channel} t={t} />
        <span className="truncate">{row.pageLabel}</span>
      </p>
    </Link>
  )
}
