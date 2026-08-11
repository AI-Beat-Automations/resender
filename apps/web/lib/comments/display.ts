import {
  formatDayLabel,
  formatLogTimestamp,
  formatMessageMeta,
} from "@/lib/inbox/log-format"

import type { PublicationComment, PublicationListItem } from "./read-model"

// Presentación del log de comentarios. Gemelo de `lib/messages/display.ts`:
// módulo puro, sin DB ni red, y todo lo que sale de aquí es serializable para
// cruzar a los componentes.
//
// La diferencia con los mensajes es de quién se sabe el nombre. En un DM el
// contacto es un PSID a secas; en un comentario Meta manda el @handle, así que
// acá el autor sí se puede nombrar y el `igsid` queda de reserva.

export type PublicationRowView = {
  /** `<connectedPageId>:<mediaId>`, la clave de `?media=`. */
  key: string
  /** `reel 17841400000000000`. */
  mediaLabel: string
  /** `@cafe.rioja · ig_id 17841400000000000`. */
  accountLabel: string
  /** `12 comentarios`. */
  countLabel: string
  /** `hoy 14:02`, `ayer 19:12`, `24 jul`, `24 jul 2025`. */
  timestamp: string
  /** El mismo instante en ISO, para el `datetime` del `<time>`. */
  timestampIso: string
  /** Renglón principal: el último comentario, con `Tú: ` en los salientes. */
  content: string
  /** El último comentario es una respuesta pública que Meta rechazó. */
  failed: boolean
}

export type CommentBubbleView = {
  id: string
  outbound: boolean
  failed: boolean
  text: string
  /** `@juanpi · inbound · 14:02:11 · received`, con `· respondiendo a …`. */
  meta: string
  /** Error crudo del proveedor, solo en `failed`. */
  error: string | null
  /** Separador de fecha cuando el comentario abre un día nuevo. */
  dayLabel: string | null
}

// Meta no manda ni título ni miniatura en el webhook de comentarios: de la
// publicación solo llegan `media.id` y `media_product_type`. Ese sustantivo es
// todo lo que se puede decir de qué se comentó, y el id va entero porque es lo
// que el usuario cita en un correo de soporte.
const MEDIA_NOUNS: Record<string, string> = {
  FEED: "publicación",
  REELS: "reel",
  STORY: "historia",
  AD: "anuncio",
}

/** `@juanpi`, con caída a `igsid 178414…` si Meta no mandó el handle. */
export function formatCommentAuthorLabel(comment: {
  fromUsername: string | null
  fromIgId: string
}) {
  const handle = comment.fromUsername?.trim()
  return handle ? `@${handle}` : `igsid ${comment.fromIgId}`
}

/** `reel 17841400000000000`. */
export function formatMediaLabel(publication: {
  mediaId: string
  mediaProductType: string | null
}) {
  const key = publication.mediaProductType?.trim().toUpperCase() ?? ""
  const noun = MEDIA_NOUNS[key] ?? "publicación"
  return `${noun} ${publication.mediaId}`
}

/** `1 comentario` · `12 comentarios`. */
export function formatCommentCount(count: number) {
  return count === 1 ? "1 comentario" : `${count} comentarios`
}

/** `@cafe.rioja · ig_id 17841…`, igual que la tarjeta de Conexiones. */
export function formatAccountLabel(account: {
  name: string
  username: string | null
  metaPageId: string
}) {
  const handle = account.username?.trim()
  return handle
    ? `@${handle} · ig_id ${account.metaPageId}`
    : `${account.name} · ig_id ${account.metaPageId}`
}

/**
 * Clave de la publicación en la URL. Es el par y no `mediaId` solo porque
 * `media_id` es un id de Meta: único dentro de la cuenta que lo publicó, no
 * dentro del tenant.
 */
export function formatPublicationKey(publication: {
  connectedPageId: string
  mediaId: string
}) {
  return `${publication.connectedPageId}:${publication.mediaId}`
}

/** Renglón principal: el último comentario, con `Tú: ` si es saliente. */
export function formatPublicationContent(
  latestComment: PublicationListItem["latestComment"]
) {
  const prefix = latestComment.direction === "outbound" ? "Tú: " : ""
  return `${prefix}${latestComment.text}`
}

export function toPublicationRowView(
  publication: PublicationListItem,
  now: Date
): PublicationRowView {
  return {
    key: formatPublicationKey(publication),
    mediaLabel: formatMediaLabel(publication),
    accountLabel: formatAccountLabel(publication.account),
    countLabel: formatCommentCount(publication.commentCount),
    timestamp: formatLogTimestamp(publication.lastCommentAt, now),
    timestampIso: publication.lastCommentAt.toISOString(),
    content: formatPublicationContent(publication.latestComment),
    failed: publication.latestComment.status === "failed",
  }
}

/**
 * Hilo completo de una publicación. Dos cosas dependen del resto del hilo y no
 * del comentario suelto: el separador de fecha, y a quién contesta un saliente.
 * Instagram anida un solo nivel, así que en vez de dibujar el árbol se nombra
 * al padre en el metadato —si está en este hilo; si Meta lo borró, no se
 * inventa nada.
 */
export function toCommentBubbleViews(
  comments: PublicationComment[]
): CommentBubbleView[] {
  const authorByCommentId = new Map<string, string>()
  for (const comment of comments) {
    if (comment.igCommentId) {
      authorByCommentId.set(
        comment.igCommentId,
        formatCommentAuthorLabel(comment)
      )
    }
  }

  let previousDay: string | null = null

  return comments.map((comment) => {
    const dayLabel = formatDayLabel(comment.createdAt)
    const isNewDay = dayLabel !== previousDay
    previousDay = dayLabel
    const failed = comment.status === "failed"

    const author = formatCommentAuthorLabel(comment)
    const parentAuthor = comment.parentIgCommentId
      ? authorByCommentId.get(comment.parentIgCommentId)
      : undefined
    const meta = [
      author,
      formatMessageMeta(comment),
      parentAuthor ? `respondiendo a ${parentAuthor}` : null,
    ]
      .filter(Boolean)
      .join(" · ")

    return {
      id: comment.id,
      outbound: comment.direction === "outbound",
      failed,
      text: comment.text,
      meta,
      error: failed ? comment.error : null,
      dayLabel: isNewDay ? dayLabel : null,
    }
  })
}
