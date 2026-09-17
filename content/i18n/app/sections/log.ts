import type { DeliveryStatus } from "@/lib/messages/message-enums"

export type LogDict = {
  /** `{time}` */
  today: string
  /** `{time}` */
  yesterday: string
  /** Prefijo del último mensaje propio en el renglón del log. */
  you: string
  noMessages: string
  /** Dirección traducida en el metadato de burbuja (mock `1h`). */
  direction: Record<"inbound" | "outbound", string>
  /** Metadato del comentario propio: `respuesta pública · 09:10`. */
  publicReply: string
  /** `{status}` */
  deliveryPrefix: string
  delivery: Record<DeliveryStatus, string>
  fromCommentSuffix: string
  /** `{author}` */
  replyingTo: string
  commentCountOne: string
  /** `{count}` */
  commentCountMany: string
  /** Sustantivo de la publicación cuando no hay caption. */
  mediaNouns: { feed: string; reels: string; story: string; ad: string }
}

export const es: LogDict = {
  today: "hoy {time}",
  yesterday: "ayer {time}",
  you: "Tú: ",
  noMessages: "Todavía no hay mensajes.",
  direction: { inbound: "entrante", outbound: "respuesta" },
  publicReply: "respuesta pública",
  deliveryPrefix: "entrega: {status}",
  delivery: {
    accepted: "aceptado",
    sent: "enviado",
    delivered: "entregado",
    read: "leído",
    failed: "no entregado",
    deleted: "eliminado",
  },
  fromCommentSuffix: "respuesta a comentario",
  replyingTo: "respondiendo a {author}",
  commentCountOne: "1 comentario",
  commentCountMany: "{count} comentarios",
  mediaNouns: {
    feed: "publicación",
    reels: "reel",
    story: "historia",
    ad: "anuncio",
  },
}

export const en: LogDict = {
  today: "today {time}",
  yesterday: "yesterday {time}",
  you: "You: ",
  noMessages: "No messages yet.",
  direction: { inbound: "incoming", outbound: "reply" },
  publicReply: "public reply",
  deliveryPrefix: "delivery: {status}",
  delivery: {
    accepted: "accepted",
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "not delivered",
    deleted: "deleted",
  },
  fromCommentSuffix: "reply to comment",
  replyingTo: "replying to {author}",
  commentCountOne: "1 comment",
  commentCountMany: "{count} comments",
  mediaNouns: {
    feed: "post",
    reels: "reel",
    story: "story",
    ad: "ad",
  },
}
