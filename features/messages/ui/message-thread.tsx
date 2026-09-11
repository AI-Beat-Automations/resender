import Link from "next/link"
import { ArrowRight, Inbox, MessageSquare, TriangleAlert } from "lucide-react"

import { Bubble } from "@/features/inbox/ui/bubble"
import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import { EmptyPane } from "@/features/inbox/ui/empty-pane"
import { ThreadHeader } from "@/features/inbox/ui/thread-header"
import type { AppDict } from "@/content/i18n/app"
import type { AttachmentDisplay } from "@/lib/inbox/message-media"
import type {
  ThreadMessageView,
  ThreadReactionView,
} from "@/lib/messages/display"
import type { PageChannel } from "@/lib/pages/page-registry"
import { cn } from "@/lib/utils"

// Hilo de solo lectura (ADR 0005), al mock `1h` (ADR 0018): cabecera de 52px,
// burbujas sobre el fondo hundido y, al pie, la franja que explica que las
// respuestas salen por la API externa. No hay «Abrir en Instagram» en
// Mensajes: deuda declarada.

export type ThreadHeaderView = {
  contactLabel: string
  /** `@cafe.rioja` · `Café Rioja` · `+52 55 1234 5678`. */
  accountLabel: string
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
    <section className="flex min-w-0 flex-1 flex-col bg-surface-sunken">
      <ThreadHeader
        title={header.contactLabel}
        pill={<ChannelBadge channel={header.channel} size="header" t={t} />}
        account={header.accountLabel}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-7 py-6">
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

      <footer className="flex shrink-0 items-center gap-2.5 border-t border-border-subtle bg-card px-5 py-3 text-[12.5px] text-muted-foreground">
        <MessageSquare className="size-3.5 shrink-0" aria-hidden />
        <span>{t.inbox.readOnlyFooter}</span>
        <Link
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
        >
          {t.inbox.readOnlyFooterCta}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </footer>
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
    <Bubble
      outbound={outbound}
      failed={failed}
      dayLabel={message.dayLabel}
      metaPlacement="below"
      error={message.error}
      after={
        // Las reacciones no son burbujas: cuelgan del mensaje al que apuntan
        // (`groupThreadReactions`). Dibujarlas como mensajes propios parte la
        // conversación en «ok», «👍», «dale» y la vuelve ilegible.
        message.reactions.length > 0 ? (
          <ReactionChips reactions={message.reactions} t={t} />
        ) : null
      }
      meta={
        // El sufijo `· respuesta a comentario` es lo único que distingue a
        // una respuesta privada de un DM cualquiera; el title explica de
        // dónde salió sin gastar otro renglón. La entrega va detrás con su
        // prefijo «entrega:» (mock `1h`): es lo que reporta Meta, distinto
        // del estado interno del envío.
        <span
          className="flex items-center gap-1.5"
          title={message.fromComment ? t.inbox.fromCommentTitle : undefined}
        >
          {failed ? (
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
          ) : null}
          {message.meta}
          {message.delivery ? (
            <span title={t.inbox.deliveryTitle}>· {message.delivery}</span>
          ) : null}
        </span>
      }
    >
      {/* El adjunto va dentro de la misma burbuja, sin cambiar color ni
          dirección (CONTEXT.md, «Semantica visual de Inbox»); si además hay
          texto, se ven los dos, adjunto arriba como en Messenger. */}
      {message.attachment ? (
        <div className={cn(message.text !== "" && "mb-2")}>
          <BubbleAttachment attachment={message.attachment} t={t} />
        </div>
      ) : null}
      {message.text !== "" ? message.text : null}
    </Bubble>
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
          className="max-h-72 max-w-full rounded-[10px]"
        />
      )
    case "video":
      return (
        <video
          controls
          src={attachment.url}
          className="max-h-72 max-w-full rounded-[10px]"
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
