import { Eye, Inbox, TriangleAlert } from "lucide-react"

import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import type { AppDict } from "@/content/i18n/app"
import { EmptyPane } from "@/features/inbox/ui/empty-pane"
import type { AttachmentDisplay } from "@/lib/inbox/message-media"
import type {
  ThreadMessageView,
  ThreadReactionView,
} from "@/lib/messages/display"
import type { PageChannel } from "@/lib/pages/page-registry"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

// Hilo de solo lectura (ADR 0005). Las burbujas usan los tokens `--bubble-*`
// del DS (spec C.3) en lugar del amarillo/verde crudo de Tailwind, y el
// saliente fallido se "vacía" y se orla en rojo en vez de rellenarse.

export type ThreadHeaderView = {
  contactLabel: string
  pageLabel: string
  channel: PageChannel
}

export function MessageThread({
  header,
  messages,
  t,
}: {
  header: ThreadHeaderView
  messages: ThreadMessageView[]
  t: AppDict
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-app">
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[14px] font-semibold">
            {header.contactLabel}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-subtle)]">
            <ChannelBadge channel={header.channel} t={t} />
            <span className="truncate">{header.pageLabel}</span>
          </p>
        </div>
        {/* El badge declara lo que la pantalla no tiene: no hay compositor,
            las respuestas salen por la API externa. */}
        <Badge variant="info" title={t.inbox.readOnlyHint}>
          <Eye aria-hidden />
          {t.inbox.readOnly}
        </Badge>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <p className="m-auto max-w-[22rem] text-center text-[14px] leading-relaxed text-muted-foreground">
            {t.inbox.threadEmpty}
          </p>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} t={t} />
          ))
        )}
      </div>
    </section>
  )
}

export function EmptyThread({
  filtered,
  t,
}: {
  filtered: boolean
  t: AppDict
}) {
  return (
    <EmptyPane
      icon={Inbox}
      title={
        filtered
          ? t.inbox.noConversationsFilteredTitle
          : t.inbox.noConversationsTitle
      }
      body={
        filtered
          ? t.inbox.noConversationsFilteredBody
          : t.inbox.noConversationsBody
      }
    />
  )
}

function MessageBubble({
  message,
  t,
}: {
  message: ThreadMessageView
  t: AppDict
}) {
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
          {/* El adjunto va dentro de la misma burbuja, sin cambiar color ni
              dirección (CONTEXT.md, «Semantica visual de Inbox»); si además
              hay texto, se ven los dos, adjunto arriba como en Messenger. */}
          {message.attachment ? (
            <div className={cn(message.text !== "" && "mb-2")}>
              <BubbleAttachment attachment={message.attachment} t={t} />
            </div>
          ) : null}
          {message.text !== "" ? message.text : null}
        </div>
        {/* Las reacciones no son burbujas: cuelgan del mensaje al que apuntan
            (`groupThreadReactions`). Dibujarlas como mensajes propios parte la
            conversación en «ok», «👍», «dale» y la vuelve ilegible. */}
        {message.reactions.length > 0 ? (
          <ReactionChips reactions={message.reactions} t={t} />
        ) : null}
        <p
          className={cn(
            "mt-[5px] flex items-center gap-1.5 font-mono text-[10.5px]",
            failed ? "text-[var(--danger-text)]" : "text-[var(--text-subtle)]"
          )}
          // El sufijo `· respuesta a comentario` es lo único que distingue a
          // una respuesta privada de un DM cualquiera; el title explica de
          // dónde salió sin gastar otro renglón.
          title={message.fromComment ? t.inbox.fromCommentTitle : undefined}
        >
          {failed ? (
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
          ) : null}
          {message.meta}
          {/* La entrega va en su propio chip y con el prefijo «entrega:»: en la
              misma línea conviven dos `sent` que no significan lo mismo — el
              `status` interno es «se lo mandamos a Meta» y el `delivery_status`
              es «Meta lo mandó al teléfono». Son dos columnas distintas y
              pintarlas iguales las confunde. */}
          {message.delivery ? (
            <span
              className="rounded-full bg-surface-sunken px-1.5 py-px"
              title={t.inbox.deliveryTitle}
            >
              {message.delivery}
            </span>
          ) : null}
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

// Reacciones del mensaje, en una tira pegada al borde de la burbuja. El emoji
// de un saliente y el de un entrante se ven igual a propósito: lo que importa
// es sobre qué mensaje están, no quién reaccionó.
function ReactionChips({
  reactions,
  t,
}: {
  reactions: ThreadReactionView[]
  t: AppDict
}) {
  return (
    <p className="-mt-1.5 flex flex-wrap gap-1">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className="rounded-full border border-border bg-card px-1.5 py-px text-[12px] leading-[1.4] shadow-[var(--shadow-sm)]"
          title={
            reaction.outbound
              ? t.inbox.reactionOutbound
              : t.inbox.reactionInbound
          }
        >
          {reaction.emoji}
        </span>
      ))}
    </p>
  )
}

// Qué se pinta ya viene decidido por `toAttachmentDisplay` (testeable en
// Vitest); acá solo se traduce cada `kind` a markup. En Messenger e Instagram
// la URL apunta directo al CDN de Meta —Resender no proxifica ni valida—, así
// que si la firma venció el preview se rompe: costo asumido de no hospedar los
// archivos. En WhatsApp es al revés: la URL es la ruta propia
// `/api/meta/whatsapp/media/{messageId}`, porque la firmada de Cloud API dura
// cinco minutos y la única copia que dura es la de R2.
function BubbleAttachment({
  attachment,
  t,
}: {
  attachment: AttachmentDisplay
  t: AppDict
}) {
  switch (attachment.kind) {
    case "image":
      return (
        // La URL es de un dominio remoto arbitrario del CDN de Meta (o una
        // ruta propia en WhatsApp): next/image exigiría declarar cada host y
        // no hay optimizador que valga para URLs firmadas que expiran —
        // <img> nativa a propósito.
        // eslint-disable-next-line @next/next/no-img-element -- CDN remoto arbitrario, sin optimizador
        <img
          src={attachment.url}
          alt={t.inbox.imageAlt}
          className="max-h-72 max-w-full rounded-[12px]"
        />
      )
    case "video":
      return (
        <video
          controls
          src={attachment.url}
          className="max-h-72 max-w-full rounded-[12px]"
        />
      )
    case "audio":
      return <audio controls src={attachment.url} className="max-w-full" />
    case "row":
      return (
        <p className="font-mono text-[12px]">
          {attachment.url ? (
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {attachment.label}
            </a>
          ) : (
            attachment.label
          )}
        </p>
      )
  }
}
