import {
  formatDayLabel,
  formatLogTimestamp,
  formatMessageMeta,
} from "@/lib/inbox/log-format"
import type { PageChannel } from "@/lib/pages/page-registry"

import type { ConversationListItem, ThreadMessage } from "./read-model"

// Presentación del log de mensajes (ADR 0005). Módulo puro: sin DB ni red, y
// todo lo que sale de aquí es serializable para cruzar a los componentes.
//
// El contacto se identifica por su @handle desde la migración 0014, que llenó
// `contact_username` con lo que devuelve Graph. Antes se mostraba siempre el
// PSID crudo —dieciocho dígitos que no le dicen nada a quien los lee— porque
// era lo único que había. El PSID sigue siendo la caída: en Messenger no hay
// perfil que pedir, y en Instagram puede que Graph no resuelva el contacto.

export type ConversationRowView = {
  id: string
  /** `@lori_surianno`, con caída a `psid <id>` si Graph no lo resolvió. */
  contactLabel: string
  /** Nombre de perfil, cuando Graph lo dio y no es igual al @handle. */
  contactName: string | null
  /** `Café Rioja · 104233889761204`, o `@cafe.rioja · ig_id 178414…`. */
  pageLabel: string
  /** Canal de la cuenta conectada, para el badge de la fila. */
  channel: PageChannel
  /** `hoy 14:02`, `ayer 19:12`, `24 jul`, `24 jul 2025`. */
  timestamp: string
  /** El mismo instante en ISO, para el `datetime` del `<time>`. */
  timestampIso: string
  /** Renglón principal: el último mensaje, con `Tú: ` en los salientes. */
  content: string
  hasMessages: boolean
  /** El último mensaje es un saliente que Meta rechazó. */
  failed: boolean
}

export type ThreadMessageView = {
  id: string
  outbound: boolean
  failed: boolean
  text: string
  /** `outbound · 14:02:11 · sent`, con `· respuesta a comentario` si lo es. */
  meta: string
  /** El saliente es la respuesta privada a un comentario de Instagram. */
  fromComment: boolean
  /** Error crudo del proveedor, solo en `failed`. */
  error: string | null
  /** Separador de fecha cuando el mensaje abre un día nuevo. */
  dayLabel: string | null
}

/** Texto del renglón principal cuando la conversación no tiene mensajes. */
export const NO_MESSAGES_CONTENT = "Todavía no hay mensajes."

/**
 * Etiqueta histórica del contacto. Se conserva para no romper llamadas
 * existentes, pero el log no la usa: ahí manda `formatPsidLabel` (ADR 0005).
 */
export function formatContactLabel(
  contactName: string | null,
  contactId: string
) {
  const name = contactName?.trim()
  return name ? name : `PSID ${contactId}`
}

/** Identificador crudo del contacto, la caída cuando no hay @handle. */
export function formatPsidLabel(contactId: string) {
  return `psid ${contactId}`
}

/**
 * Etiqueta del contacto en el log: `@lori_surianno`, y `psid 1004146…` cuando
 * Graph no lo resolvió o el canal no tiene perfil que pedir.
 */
export function formatContactHandle(conversation: {
  contactUsername: string | null
  contactId: string
}) {
  const handle = conversation.contactUsername?.trim()
  return handle ? `@${handle}` : formatPsidLabel(conversation.contactId)
}

/**
 * `Café Rioja · 104233889761204` en Messenger, `@cafe.rioja · ig_id 178414…`
 * en Instagram. Mismo criterio que la tarjeta de Conexiones: en Instagram el
 * @handle es lo que el usuario reconoce, y el IG ID es lo que cita en soporte.
 */
export function formatPageLabel(page: {
  channel: PageChannel
  name: string
  username: string | null
  metaPageId: string
}) {
  if (page.channel === "instagram" && page.username) {
    return `@${page.username} · ig_id ${page.metaPageId}`
  }
  return `${page.name} · ${page.metaPageId}`
}

/** Renglón principal del log: el último mensaje, con `Tú: ` si es saliente. */
export function formatConversationContent(
  latestMessage: ConversationListItem["latestMessage"]
) {
  if (!latestMessage) return NO_MESSAGES_CONTENT
  const prefix = latestMessage.direction === "outbound" ? "Tú: " : ""
  return `${prefix}${latestMessage.text}`
}

export function toConversationRowView(
  conversation: ConversationListItem,
  now: Date
): ConversationRowView {
  const { latestMessage } = conversation
  const name = conversation.contactName?.trim()

  return {
    id: conversation.id,
    contactLabel: formatContactHandle(conversation),
    // El nombre solo entra si aporta algo: Instagram devuelve muchas cuentas
    // donde `name` y `username` son lo mismo, y repetirlo es ruido.
    contactName:
      name && name.toLowerCase() !== conversation.contactUsername?.toLowerCase()
        ? name
        : null,
    pageLabel: formatPageLabel(conversation.page),
    channel: conversation.page.channel,
    timestamp: formatLogTimestamp(conversation.lastMessageAt, now),
    timestampIso: conversation.lastMessageAt.toISOString(),
    content: formatConversationContent(latestMessage),
    hasMessages: latestMessage !== null,
    failed: latestMessage?.status === "failed",
  }
}

/**
 * Hilo completo. El separador de fecha se resuelve aquí porque depende del
 * mensaje anterior, no del mensaje suelto.
 */
export function toThreadMessageViews(
  messages: ThreadMessage[]
): ThreadMessageView[] {
  let previousDay: string | null = null

  return messages.map((message) => {
    const dayLabel = formatDayLabel(message.createdAt)
    const isNewDay = dayLabel !== previousDay
    previousDay = dayLabel
    const failed = message.status === "failed"
    // El sufijo se compone acá y no en `formatMessageMeta`, que ahora lo
    // comparten los dos modos de Inbox: un comentario nunca es respuesta
    // privada de nada.
    const fromComment = message.instagramSourceCommentId !== null

    return {
      id: message.id,
      outbound: message.direction === "outbound",
      failed,
      text: message.text,
      meta: fromComment
        ? `${formatMessageMeta(message)} · respuesta a comentario`
        : formatMessageMeta(message),
      fromComment,
      error: failed ? message.error : null,
      dayLabel: isNewDay ? dayLabel : null,
    }
  })
}
