import { ExternalLink, TriangleAlert } from "lucide-react"

import { Bubble } from "@/features/inbox/ui/bubble"
import { ThreadHeader } from "@/features/inbox/ui/thread-header"
import type { AppDict } from "@/content/i18n/app"
import type { CommentBubbleView } from "@/lib/comments/display"

// Hilo de comentarios de una publicación, de solo lectura como el de mensajes
// (ADR 0005) y con las mismas burbujas (mock `1i`, ADR 0018). Lo que cambia
// es la cabecera, que nombra la publicación en vez del contacto y lleva el
// enlace al post en Instagram: es lo que el usuario necesita para contestar
// de verdad, porque acá no hay compositor. Solo aparece si Graph resolvió el
// permalink.
//
// No hay rama de "todavía no hay comentarios": una publicación llega a esta
// lista solo porque tiene al menos uno.

export type CommentThreadHeaderView = {
  /** El caption recortado, o `reel 1784…` si no hay. */
  mediaLabel: string
  /** `reel` · `publicación`, la píldora junto al título. */
  mediaNoun: string
  mediaPermalink: string | null
  /** `@cafe.rioja`. */
  accountHandle: string
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
      <ThreadHeader
        title={header.mediaLabel}
        pill={
          <span className="inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 text-[11.5px] text-text-secondary">
            {header.mediaNoun}
          </span>
        }
        account={header.accountHandle}
        action={
          header.mediaPermalink ? (
            <a
              href={header.mediaPermalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-[5px] text-[12.5px] text-text-secondary transition-colors hover:bg-muted hover:text-foreground"
            >
              {t.inbox.openInInstagram}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-7 py-6">
        {comments.map((comment) => (
          <Bubble
            key={comment.id}
            outbound={comment.outbound}
            failed={comment.failed}
            dayLabel={comment.dayLabel}
            metaPlacement="above"
            error={comment.error}
            meta={
              <>
                {comment.failed ? (
                  <TriangleAlert className="size-3 shrink-0" aria-hidden />
                ) : null}
                {comment.meta}
              </>
            }
          >
            {comment.text}
          </Bubble>
        ))}
      </div>
    </section>
  )
}
