import type { InboxTab } from "@/lib/inbox/inbox-tabs"
import type { AttachmentStatus } from "@/lib/messages/message-enums"

export type InboxDict = {
  title: string
  tabs: Record<InboxTab, string>
  tabsAria: string
  filterAll: string
  /** Combobox de cuenta (mock `1i`): aria del botón, placeholder y vacío. */
  accountPickerLabel: string
  accountPickerSearch: string
  accountPickerEmpty: string
  /** Franja al pie del hilo de mensajes (mock `1h`), con su enlace a docs. */
  readOnlyFooter: string
  readOnlyFooterCta: string
  emptyConversations: string
  emptyConversationsFiltered: string
  emptyComments: string
  emptyCommentsFiltered: string
  readOnly: string
  readOnlyHint: string
  threadEmpty: string
  /** El vacío del panel derecho, en sus cuatro combinaciones. */
  noConversationsTitle: string
  noConversationsFilteredTitle: string
  noConversationsBody: string
  noConversationsFilteredBody: string
  noCommentsTitle: string
  noCommentsFilteredTitle: string
  noCommentsBody: string
  noCommentsFilteredBody: string
  noInstagramTitle: string
  noInstagramBody: string
  noInstagramCta: string
  openInInstagram: string
  fromCommentTitle: string
  deliveryTitle: string
  reactionOutbound: string
  reactionInbound: string
  imageAlt: string
  /**
   * Lo que la burbuja dice en cada estado del binario (`attachment_status`,
   * 0017). Los cinco son distintos porque los cinco estados son distintos:
   * colapsar `failed` con `unavailable` en un «no se pudo mostrar» genérico
   * deja a soporte sin poder distinguir un bug nuestro de un límite de Meta.
   */
  attachmentStatus: Record<AttachmentStatus, string>
  /**
   * Pausa de reenvío de la conversación (ADR 0020), en la cabecera del hilo.
   * Solo etiqueta y switch, sin texto de estado: el desde cuándo lo cuenta
   * el hilo (ADR 0021).
   */
  pauseLabel: string
  pauseAria: string
  /**
   * Eventos de pausa dentro del hilo (ADR 0021), `{date}` ya con hora:
   * «Automatización pausada desde el 14 sep 2026, 10:32».
   */
  pauseEventPaused: string
  pauseEventResumed: string
  /** `title` del icono de pausa en la fila de la lista. */
  pausedRowTitle: string
}

export const es: InboxDict = {
  title: "Inbox",
  tabs: { mensajes: "Mensajes", comentarios: "Comentarios" },
  tabsAria: "Modo de la bandeja",
  filterAll: "Todas las cuentas",
  accountPickerLabel: "Filtrar por cuenta",
  accountPickerSearch: "Buscar cuenta…",
  accountPickerEmpty: "Ninguna cuenta coincide.",
  readOnlyFooter:
    "Las respuestas salen por la API externa. Esta pantalla es de solo lectura.",
  readOnlyFooterCta: "Ver la API de envío",
  emptyConversations: "Todavía no hay conversaciones.",
  emptyConversationsFiltered: "No hay conversaciones para este filtro.",
  emptyComments: "Todavía no hay comentarios.",
  emptyCommentsFiltered: "No hay comentarios para este filtro.",
  readOnly: "solo lectura",
  readOnlyHint: "Las respuestas salen por la API externa",
  threadEmpty: "Esta conversación todavía no tiene mensajes guardados.",
  noConversationsTitle: "Todavía no hay conversaciones guardadas.",
  noConversationsFilteredTitle: "Esta cuenta todavía no tiene conversaciones.",
  noConversationsBody:
    "Cuando alguien escriba a esta cuenta, el mensaje se guarda acá y se reenvía a tu webhook.",
  noConversationsFilteredBody:
    "El filtro no devolvió ninguna conversación. Prueba con «Todas las cuentas» para ver el resto del log.",
  noCommentsTitle: "Todavía no hay comentarios guardados.",
  noCommentsFilteredTitle: "Esta cuenta todavía no tiene comentarios.",
  noCommentsBody:
    "Cuando alguien comente una publicación, el comentario se guarda acá y se reenvía a tu webhook.",
  noCommentsFilteredBody:
    "El filtro no devolvió ninguna publicación. Prueba con «Todas las cuentas» para ver el resto del log.",
  noInstagramTitle: "Todavía no hay ninguna cuenta de Instagram conectada.",
  noInstagramBody:
    "Los comentarios llegan solo por Instagram. Conecta una cuenta profesional para verlos acá.",
  noInstagramCta: "Ir a Conexiones",
  openInInstagram: "Abrir en Instagram",
  fromCommentTitle: "Salió como respuesta privada a un comentario de Instagram",
  deliveryTitle:
    "Lo que reporta Meta sobre la entrega, distinto del estado interno del envío",
  reactionOutbound: "Reacción del negocio",
  reactionInbound: "Reacción del contacto",
  imageAlt: "Adjunto de imagen",
  pauseLabel: "Automatización",
  pauseAria: "Pausar o reanudar la automatización de esta conversación",
  pauseEventPaused: "Automatización pausada desde el {date}",
  pauseEventResumed: "Automatización activada desde el {date}",
  pausedRowTitle: "Automatización pausada para este contacto",
  attachmentStatus: {
    pending: "descargando…",
    available: "preview / descarga",
    failed: "no se pudo descargar",
    deleted: "archivo expirado",
    unavailable: "WhatsApp no conserva archivos de más de 14 días",
  },
}

export const en: InboxDict = {
  title: "Inbox",
  tabs: { mensajes: "Messages", comentarios: "Comments" },
  tabsAria: "Inbox mode",
  filterAll: "All accounts",
  accountPickerLabel: "Filter by account",
  accountPickerSearch: "Search account…",
  accountPickerEmpty: "No account matches.",
  readOnlyFooter:
    "Replies go out through the external API. This screen is read-only.",
  readOnlyFooterCta: "See the send API",
  emptyConversations: "No conversations yet.",
  emptyConversationsFiltered: "No conversations for this filter.",
  emptyComments: "No comments yet.",
  emptyCommentsFiltered: "No comments for this filter.",
  readOnly: "read-only",
  readOnlyHint: "Replies go out through the external API",
  threadEmpty: "This conversation has no saved messages yet.",
  noConversationsTitle: "No conversations saved yet.",
  noConversationsFilteredTitle: "This account has no conversations yet.",
  noConversationsBody:
    "When someone writes to this account, the message is saved here and forwarded to your webhook.",
  noConversationsFilteredBody:
    "The filter didn't return any conversation. Try «All accounts» to see the rest of the log.",
  noCommentsTitle: "No comments saved yet.",
  noCommentsFilteredTitle: "This account has no comments yet.",
  noCommentsBody:
    "When someone comments on a post, the comment is saved here and forwarded to your webhook.",
  noCommentsFilteredBody:
    "The filter didn't return any post. Try «All accounts» to see the rest of the log.",
  noInstagramTitle: "No Instagram account connected yet.",
  noInstagramBody:
    "Comments only arrive through Instagram. Connect a professional account to see them here.",
  noInstagramCta: "Go to Connections",
  openInInstagram: "Open on Instagram",
  fromCommentTitle: "Sent as a private reply to an Instagram comment",
  deliveryTitle:
    "What Meta reports about delivery, different from the internal send status",
  reactionOutbound: "Reaction from the business",
  reactionInbound: "Reaction from the contact",
  imageAlt: "Image attachment",
  pauseLabel: "Automation",
  pauseAria: "Pause or resume automation for this conversation",
  pauseEventPaused: "Automation paused since {date}",
  pauseEventResumed: "Automation resumed on {date}",
  pausedRowTitle: "Automation paused for this contact",
  attachmentStatus: {
    pending: "downloading…",
    available: "preview / download",
    failed: "couldn't download",
    deleted: "file expired",
    unavailable: "WhatsApp doesn't keep files older than 14 days",
  },
}
