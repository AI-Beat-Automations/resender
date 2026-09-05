import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import type { AppDict } from "@/content/i18n/app"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import type { ConversationRowView } from "@/lib/messages/display"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

// Filas de conversaciones como LOG, no como bandeja (ADR 0005): sin avatar de
// iniciales. Es el bloque con scroll de la columna izquierda (mock 1h); la
// cabecera y los filtros los pone la página, porque son los mismos en los dos
// modos. Tres renglones: identificador + hora, último mensaje —con `Tú:`
// atenuado cuando es respuesta— y canal + cuenta al pie. El identificador es
// el @handle desde la migración 0014; el `psid …` es la caída y va en mono
// porque es un id, no un nombre.

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
    <div className="mt-2.5 flex min-h-0 flex-1 flex-col border-t border-border-subtle">
      <h2 className="sr-only">{t.inbox.conversationsHeading}</h2>
      {rows.length === 0 ? (
        // Dos vacíos distintos: sin datos vs. el filtro no devolvió nada.
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
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
    </div>
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
        "block border-b border-l-2 border-border-subtle px-4 py-3.5 transition-colors",
        active
          ? "border-l-foreground bg-muted"
          : "border-l-transparent hover:bg-surface-sunken"
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
          "mt-[3px] truncate text-[13px]",
          row.failed
            ? "text-[var(--danger-text)]"
            : row.hasMessages
              ? "text-[var(--text-body)]"
              : "text-muted-foreground italic"
        )}
      >
        <LogContent content={row.content} t={t} />
      </p>
      <p className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
        <ChannelBadge channel={row.channel} t={t} />
        <span className="truncate">{row.pageLabel}</span>
      </p>
    </Link>
  )
}

// El `Tú: ` ya viene dentro de `content` (display.ts); acá solo se separa
// para atenuarlo como en el mock, sin cambiar el texto.
export function LogContent({ content, t }: { content: string; t: AppDict }) {
  const prefix = t.log.you
  if (!content.startsWith(prefix)) return content
  return (
    <>
      <span className="text-muted-foreground">{prefix}</span>
      {content.slice(prefix.length)}
    </>
  )
}
