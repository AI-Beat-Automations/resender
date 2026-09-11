import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import type { AppDict } from "@/content/i18n/app"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import type { ConversationRowView } from "@/lib/messages/display"
import { cn } from "@/lib/utils"

// Lista de conversaciones (mock `1h`, ADR 0018): tres renglones por fila —el
// contacto y la hora, el último mensaje, el canal y la cuenta—, sin avatar
// (ADR 0005). El identificador es el @handle desde la migración 0014; el PSID
// crudo va en mono porque es un id, no un nombre.

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
  if (rows.length === 0) {
    // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
    return (
      <p className="px-4 py-5 text-[13px] text-muted-foreground">
        {selectedAccountId
          ? t.inbox.emptyConversationsFiltered
          : t.inbox.emptyConversations}
      </p>
    )
  }

  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id}>
          <ConversationRow
            row={row}
            active={row.id === selectedConversationId}
            selectedAccountId={selectedAccountId}
            t={t}
          />
        </li>
      ))}
    </ul>
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
        "block border-b border-l-2 border-border-faint px-4 py-3.5 transition-colors",
        active
          ? "border-l-primary bg-muted"
          : "border-l-transparent hover:bg-muted/50"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p
          className={cn(
            "flex min-w-0 items-center gap-1.5 font-medium",
            row.contactMono ? "font-mono text-[12.5px]" : "text-[13.5px]",
            row.failed && "text-[var(--danger-text)]"
          )}
        >
          {row.failed ? (
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
          ) : null}
          <span className="truncate">{row.contactLabel}</span>
          {row.contactName ? (
            <span className="truncate text-[11.5px] font-normal text-[var(--text-subtle)]">
              {row.contactName}
            </span>
          ) : null}
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
          row.failed
            ? "text-[var(--danger-text)]"
            : row.hasMessages
              ? "text-text-secondary"
              : "text-muted-foreground italic"
        )}
      >
        {row.previewPrefix ? (
          <span className="text-muted-foreground">{row.previewPrefix}</span>
        ) : null}
        {row.previewText}
        {row.failedLabel ? ` · ${row.failedLabel}` : null}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ChannelBadge channel={row.channel} t={t} />
        <span className="truncate font-mono text-[10.5px]">
          {row.accountLabel}
        </span>
      </p>
    </Link>
  )
}
