import { ExternalLink, Eye, TriangleAlert } from "lucide-react"

import type { CommentBubbleView } from "@/lib/comments/display"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

// Hilo de comentarios de una publicación, de solo lectura como el de mensajes
// (ADR 0005) y con las mismas burbujas: entrante a la izquierda, saliente a la
// derecha, y el saliente rechazado por Meta se "vacía" y se orla en rojo en vez
// de rellenarse. Es deliberado que un comentario y un DM se lean igual —los dos
// son un ida y vuelta con la misma persona—; lo que cambia es la cabecera, que
// nombra la publicación en vez del contacto.
//
// No hay rama de "todavía no hay comentarios": una publicación llega a esta
// lista solo porque tiene al menos uno.

export type CommentThreadHeaderView = {
  mediaLabel: string
  mediaPermalink: string | null
  accountLabel: string
}

export function CommentThread({
  header,
  comments,
}: {
  header: CommentThreadHeaderView
  comments: CommentBubbleView[]
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-app">
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0 flex-1">
          {/* El enlace abre el post en Instagram: es lo que el usuario necesita
              para contestar de verdad, porque acá no hay compositor. Solo
              aparece si Graph resolvió el permalink. */}
          <h2 className="truncate text-[14px] font-semibold">
            {header.mediaPermalink ? (
              <a
                href={header.mediaPermalink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1.5 hover:underline"
              >
                <span className="truncate">{header.mediaLabel}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden />
                <span className="sr-only">Abrir en Instagram</span>
              </a>
            ) : (
              header.mediaLabel
            )}
          </h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-subtle)]">
            {header.accountLabel}
          </p>
        </div>
        {/* El badge declara lo que la pantalla no tiene: no hay compositor, las
            respuestas salen por la API externa. */}
        <Badge variant="info" title="Las respuestas salen por la API externa">
          <Eye aria-hidden />
          solo lectura
        </Badge>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-6">
        {comments.map((comment) => (
          <CommentBubble key={comment.id} comment={comment} />
        ))}
      </div>
    </section>
  )
}

function CommentBubble({ comment }: { comment: CommentBubbleView }) {
  const { outbound, failed } = comment

  return (
    <>
      {comment.dayLabel ? (
        <p className="self-center font-mono text-[10.5px] text-[var(--text-subtle)]">
          {comment.dayLabel}
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
          {comment.text}
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
          {comment.meta}
        </p>
        {comment.error ? (
          <p
            className={cn(
              "mt-1 font-mono text-[10.5px] text-[var(--danger-text)]",
              outbound ? "text-right" : "text-left"
            )}
          >
            {comment.error}
          </p>
        ) : null}
      </article>
    </>
  )
}
