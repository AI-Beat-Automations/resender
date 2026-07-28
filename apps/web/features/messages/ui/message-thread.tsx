import { Eye, Inbox, TriangleAlert } from "lucide-react"

import type { ThreadMessageView } from "@/lib/messages/display"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

// Hilo de solo lectura (ADR 0005). Las burbujas usan los tokens `--bubble-*`
// del DS (spec C.3) en lugar del amarillo/verde crudo de Tailwind, y el
// saliente fallido se "vacía" y se orla en rojo en vez de rellenarse.

export type ThreadHeaderView = {
  contactLabel: string
  pageLabel: string
}

export function MessageThread({
  header,
  messages,
}: {
  header: ThreadHeaderView
  messages: ThreadMessageView[]
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-app">
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[14px] font-semibold">
            {header.contactLabel}
          </h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-subtle)]">
            {header.pageLabel}
          </p>
        </div>
        {/* El badge declara lo que la pantalla no tiene: no hay compositor,
            las respuestas salen por la API externa. */}
        <Badge variant="info" title="Las respuestas salen por la API externa">
          <Eye aria-hidden />
          solo lectura
        </Badge>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <p className="m-auto max-w-[22rem] text-center text-[14px] leading-relaxed text-muted-foreground">
            Esta conversación todavía no tiene mensajes guardados.
          </p>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>
    </section>
  )
}

export function EmptyThread({ filtered }: { filtered: boolean }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3.5 bg-surface-app p-10 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <Inbox className="size-[22px]" />
      </span>
      <div className="max-w-[400px]">
        <h2 className="font-heading text-[18px] font-semibold tracking-[-0.02em]">
          {filtered
            ? "Esta página todavía no tiene conversaciones."
            : "Todavía no hay conversaciones guardadas."}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          {filtered
            ? "El filtro no devolvió ninguna conversación. Prueba con «Todas las páginas» para ver el resto del log."
            : "Cuando alguien escriba a esta página, el mensaje se guarda acá y se reenvía a tu webhook."}
        </p>
      </div>
    </section>
  )
}

function MessageBubble({ message }: { message: ThreadMessageView }) {
  const { outbound, failed } = message

  return (
    <>
      {message.dayLabel ? (
        <p className="self-center font-mono text-[10.5px] text-[var(--text-subtle)]">
          {message.dayLabel}
        </p>
      ) : null}
      <article
        className={cn(
          "flex max-w-[62%] flex-col",
          outbound ? "items-end self-end" : "items-start self-start"
        )}
      >
        <div
          className={cn(
            "rounded-[var(--radius-3xl)] border px-[15px] py-[11px] text-[14px] leading-[1.55] break-words whitespace-pre-wrap",
            outbound ? "rounded-br-[6px]" : "rounded-bl-[6px]",
            failed
              ? "border-[var(--danger-soft-border)] bg-card text-foreground"
              : outbound
                ? "border-bubble-out-border bg-bubble-out text-bubble-out-foreground"
                : "border-bubble-in-border bg-bubble-in text-bubble-in-foreground"
          )}
        >
          {message.text}
        </div>
        <p
          className={cn(
            "mt-[5px] flex items-center gap-1.5 font-mono text-[10.5px]",
            failed ? "text-[var(--danger-text)]" : "text-[var(--text-subtle)]"
          )}
        >
          {failed ? (
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
          ) : null}
          {message.meta}
        </p>
        {message.error ? (
          <p
            className={cn(
              "mt-1 font-mono text-[10.5px] text-[var(--danger-text)]",
              outbound ? "text-right" : "text-left"
            )}
          >
            {message.error}
          </p>
        ) : null}
      </article>
    </>
  )
}
