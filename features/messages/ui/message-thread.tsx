import Link from "next/link"
import {
  ArrowRight,
  Inbox,
  MessageSquare,
  Pause,
  Play,
  TriangleAlert,
} from "lucide-react"

import { setConversationForwardingPaused } from "@/features/inbox/actions"
import { Bubble } from "@/features/inbox/ui/bubble"
import { ChannelBadge } from "@/features/inbox/ui/channel-badge"
import { EmptyPane } from "@/features/inbox/ui/empty-pane"
import { ThreadHeader } from "@/features/inbox/ui/thread-header"
import { ClientLabel } from "@/features/clients/ui/client-label"
import { ForwardingPauseSwitch } from "@/components/forwarding-pause-switch"
import type { AppDict } from "@/content/i18n/app"
import type { AttachmentDisplay } from "@/lib/inbox/message-media"
import type {
  ThreadEntryView,
  ThreadMessageView,
  ThreadPauseEventView,
  ThreadReactionView,
} from "@/lib/messages/display"
import type { PageChannel } from "@/lib/pages/page-registry"
import { cn } from "@/lib/utils"

// Hilo de solo lectura (ADR 0005), al mock `1h` (ADR 0018): cabecera de 52px,
// burbujas sobre el fondo hundido y, al pie, la franja que explica que las
// respuestas salen por la API externa. No hay «Abrir en Instagram» en
// Mensajes: deuda declarada. El hueco de la derecha de la cabecera lo ocupa
// desde la ADR 0020 el interruptor de pausa de reenvío, sin texto de estado:
// el switch ya dice si está encendida, y el desde cuándo va dentro del hilo,
// como un evento más entre las burbujas (ADR 0021).

export type ThreadHeaderView = {
  conversationId: string
  contactLabel: string
  /** `@cafe.rioja` · `Café Rioja` · `+52 55 1234 5678`. */
  accountLabel: string
  channel: PageChannel
  /** Pausa de reenvío (ADR 0020): ISO o null. */
  pausedAt: string | null
  /** Nombre del cliente dueño de la cuenta (issue #154); null si es propia. */
  clientName: string | null
}

export function MessageThread({
  header,
  entries,
  t,
}: {
  header: ThreadHeaderView
  /** Burbujas y eventos de pausa, ya en orden (`toThreadTimeline`). */
  entries: ThreadEntryView[]
  t: AppDict
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-sunken">
      <ThreadHeader
        title={header.contactLabel}
        pill={<ChannelBadge channel={header.channel} size="header" t={t} />}
        account={header.accountLabel}
        tag={
          header.clientName ? (
            <ClientLabel
              name={header.clientName}
              t={t}
              size="header"
            />
          ) : null
        }
        action={
          // Acción ya ligada al id desde el servidor: el `Switch` solo manda
          // el estado nuevo, y un id ajeno no existe para esta sesión.
          <ForwardingPauseSwitch
            size="sm"
            className="shrink-0"
            pausedAt={header.pausedAt}
            label={t.inbox.pauseLabel}
            ariaLabel={t.inbox.pauseAria}
            state={null}
            action={setConversationForwardingPaused.bind(
              null,
              header.conversationId
            )}
          />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-7 py-6">
        {entries.length === 0 ? (
          <p className="m-auto max-w-[22rem] text-center text-[14px] leading-relaxed text-muted-foreground">
            {t.inbox.threadEmpty}
          </p>
        ) : (
          entries.map((entry) =>
            entry.kind === "pause" ? (
              <PauseEventRow key={entry.id} event={entry} />
            ) : (
              <MessageBubble key={entry.id} message={entry} t={t} />
            )
          )
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

// Tres vacíos: sin datos, el filtro de cuenta no devolvió nada, o el filtro
// por cliente del padre (issue #154) no devolvió nada. Cada uno sugiere
// soltar el filtro que corresponde.
export function EmptyThread({
  filtered,
  t,
}: {
  filtered: "none" | "account" | "client"
  t: AppDict
}) {
  return (
    <EmptyPane
      icon={Inbox}
      title={
        filtered === "account"
          ? t.inbox.noConversationsFilteredTitle
          : filtered === "client"
            ? t.inbox.noConversationsClientFilteredTitle
            : t.inbox.noConversationsTitle
      }
      body={
        filtered === "account"
          ? t.inbox.noConversationsFilteredBody
          : filtered === "client"
            ? t.inbox.noConversationsClientFilteredBody
            : t.inbox.noConversationsBody
      }
    />
  )
}

// Evento de pausa dentro del hilo (ADR 0021): una píldora centrada, como el
// separador de fecha pero con cuerpo, en aviso cuando se pausó y en éxito
// cuando se reactivó. Va donde ocurrió, entre las burbujas: así se lee de un
// vistazo qué mensajes llegaron con el bot apagado.
function PauseEventRow({ event }: { event: ThreadPauseEventView }) {
  const Icon = event.paused ? Pause : Play
  return (
    <>
      {event.dayLabel ? (
        <p className="self-center font-mono text-[10.5px] text-[var(--text-subtle)]">
          {event.dayLabel}
        </p>
      ) : null}
      <p
        className={cn(
          "inline-flex items-center gap-1.5 self-center rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
          event.paused
            ? "border-warning-soft-border bg-warning-soft text-warning-soft-foreground"
            : "border-success-soft-border bg-success-soft text-success-soft-foreground"
        )}
      >
        <Icon className="size-3 shrink-0 fill-current" aria-hidden />
        {event.text}
      </p>
    </>
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
