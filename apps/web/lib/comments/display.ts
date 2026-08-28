import {
  formatDayLabel,
  formatLogTimestamp,
  formatMessageMeta,
} from "@/lib/inbox/log-format"

import { fmt, type AppDict } from "@/content/i18n/app"

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
  /** El caption recortado, o `reel 17841400000000000` si no hay. */
  mediaLabel: string
  /** URL pública del post en Instagram, null hasta que Graph la resuelva. */
  mediaPermalink: string | null
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

// El webhook de comentarios solo trae `media.id` y `media_product_type`. El
// caption y el permalink salen de Graph y se cachean (migración 0014); este
// sustantivo más el id es la caída para cuando todavía no se resolvieron o
// Meta no los devuelve.
// El `media_product_type` que manda Meta, en mayúsculas, contra la clave del
// diccionario. El mapa se queda acá porque es del webhook, no del idioma; el
// sustantivo sale de `t.log.mediaNouns`.
const MEDIA_NOUN_KEYS = {
  FEED: "feed",
  REELS: "reels",
  STORY: "story",
  AD: "ad",
} as const satisfies Record<string, keyof AppDict["log"]["mediaNouns"]>

// Un caption de Instagram puede tener 2200 caracteres y varios párrafos de
// hashtags. En un renglón de log entra la primera línea y poco más.
const CAPTION_MAX_LENGTH = 60

/** `@juanpi`, con caída a `igsid 178414…` si Meta no mandó el handle. */
export function formatCommentAuthorLabel(comment: {
  fromUsername: string | null
  fromIgId: string
}) {
  const handle = comment.fromUsername?.trim()
  return handle ? `@${handle}` : `igsid ${comment.fromIgId}`
}

/**
 * Cómo se nombra la publicación en el log: el caption si Graph lo dio, y si no
 * `reel 17841400000000000`. Se recorta a la primera línea porque un caption
 * suele terminar en tres renglones de hashtags que no identifican nada.
 */
export function formatMediaLabel(
  publication: {
    mediaId: string
    mediaProductType: string | null
    caption?: string | null
  },
  t: AppDict
) {
  const caption = truncateCaption(publication.caption)
  if (caption) return caption

  const key = publication.mediaProductType?.trim().toUpperCase() ?? ""
  const nounKey =
    key in MEDIA_NOUN_KEYS
      ? MEDIA_NOUN_KEYS[key as keyof typeof MEDIA_NOUN_KEYS]
      : "feed"
  return `${t.log.mediaNouns[nounKey]} ${publication.mediaId}`
}

function truncateCaption(caption: string | null | undefined) {
  const firstLine = caption?.split("\n")[0]?.trim()
  if (!firstLine) return null
  if (firstLine.length <= CAPTION_MAX_LENGTH) return firstLine
  return `${firstLine.slice(0, CAPTION_MAX_LENGTH).trimEnd()}…`
}

/** `1 comentario` · `12 comentarios`. */
export function formatCommentCount(count: number, t: AppDict) {
  return count === 1
    ? t.log.commentCountOne
    : fmt(t.log.commentCountMany, { count })
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
  latestComment: PublicationListItem["latestComment"],
  t: AppDict
) {
  const prefix = latestComment.direction === "outbound" ? t.log.you : ""
  return `${prefix}${latestComment.text}`
}

export function toPublicationRowView(
  publication: PublicationListItem,
  now: Date,
  t: AppDict,
  media?: { permalink: string | null; caption: string | null }
): PublicationRowView {
  return {
    key: formatPublicationKey(publication),
    mediaLabel: formatMediaLabel(
      { ...publication, caption: media?.caption },
      t
    ),
    mediaPermalink: media?.permalink ?? null,
    accountLabel: formatAccountLabel(publication.account),
    countLabel: formatCommentCount(publication.commentCount, t),
    timestamp: formatLogTimestamp(publication.lastCommentAt, now, t),
    timestampIso: publication.lastCommentAt.toISOString(),
    content: formatPublicationContent(publication.latestComment, t),
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
  comments: PublicationComment[],
  t: AppDict
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
    const dayLabel = formatDayLabel(comment.createdAt, t)
    const isNewDay = dayLabel !== previousDay
    previousDay = dayLabel
    const failed = comment.status === "failed"

    const author = formatCommentAuthorLabel(comment)
    const parentAuthor = comment.parentIgCommentId
      ? authorByCommentId.get(comment.parentIgCommentId)
      : undefined
    const meta = [
      author,
      formatMessageMeta(comment, t),
      parentAuthor ? fmt(t.log.replyingTo, { author: parentAuthor }) : null,
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
