import { ExternalLink, TriangleAlert } from "lucide-react"

import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import type { AppDict } from "@/content/i18n/app"
import type { CommentBubbleView } from "@/lib/comments/display"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

// Hilo de comentarios de una publicación, de solo lectura como el de mensajes
// (ADR 0005) y con las mismas burbujas en la misma columna derecha (mock 1i):
// entrante a la izquierda, saliente a la derecha, y el saliente rechazado por
// Meta se "vacía" y se orla en rojo en vez de rellenarse. Es deliberado que un
// comentario y un DM se lean igual —los dos son un ida y vuelta con la misma
// persona—; lo que cambia es la cabecera, que nombra la publicación en vez del
// contacto, y que la meta (quién y cuándo) va ENCIMA de la burbuja, porque en
// un post el autor cambia en cada comentario y hay que leerlo antes del texto.
//
// No hay pie de solo lectura ni rama de "todavía no hay comentarios": una
// publicación llega a esta lista solo porque tiene al menos uno, y el botón
// «Abrir en Instagram» ya es la salida para contestar.

export type CommentThreadHeaderView = {
  mediaLabel: string
  mediaPermalink: string | null
  accountLabel: string
}

export function CommentThread({
  header,
  comments,
  t,
}: {
  header: CommentThreadHeaderView
  comments: CommentBubbleView[]
  t: AppDict
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-sunken">
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border-subtle bg-card px-5">
        <h2 className="min-w-0 truncate font-heading text-[15px] font-semibold">
          {header.mediaLabel}
        </h2>
        {/* El mock pinta aquí «reel»/«publicación». El tipo llega al read
            model pero solo embebido en `mediaLabel`; exponerlo aparte toca
            `lib/comments/display.ts` (deuda). Mientras, el canal. */}
        <ChannelBadge
          channel="instagram"
          className="px-2 text-[11.5px]"
          t={t}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--text-subtle)]">
          · {header.accountLabel}
        </span>
        {/* El enlace abre el post en Instagram: es lo que el usuario necesita
            para contestar de verdad, porque acá no hay compositor. Solo
            aparece si Graph resolvió el permalink. */}
        {header.mediaPermalink ? (
          <Button asChild variant="outline" size="sm">
            <a
              href={header.mediaPermalink}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.inbox.openInInstagram}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        ) : null}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3.5 px-7 py-6">
          {comments.map((comment) => (
            <CommentBubble key={comment.id} comment={comment} />
          ))}
        </div>
      </ScrollArea>
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
        <p
          className={cn(
            "mb-1 flex items-center gap-1.5 font-mono text-[10.5px]",
            failed ? "text-[var(--danger-text)]" : "text-[var(--text-subtle)]"
          )}
        >
          {failed ? (
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
          ) : null}
          {comment.meta}
        </p>
        <div
          className={cn(
            "rounded-[14px] border px-3.5 py-2.5 text-sm leading-normal break-words whitespace-pre-wrap",
            outbound ? "rounded-br-[4px]" : "rounded-bl-[4px]",
            failed
              ? "border-[var(--danger-soft-border)] bg-card text-foreground"
              : outbound
                ? "border-bubble-out-border bg-bubble-out text-bubble-out-foreground"
                : "border-bubble-in-border bg-bubble-in text-bubble-in-foreground"
          )}
        >
          {comment.text}
        </div>
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
