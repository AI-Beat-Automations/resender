import type { ConversationListItem, ThreadMessage } from "./view-model"

// Presentación del log de mensajes (ADR 0005). Módulo puro: sin DB ni red, y
// todo lo que sale de aquí es serializable para cruzar a los componentes.
//
// El contacto se muestra SIEMPRE como PSID para conservar la semántica del log:
// el último mensaje ocupa el renglón principal y el identificador estable del
// contacto queda como dato secundario.

export type ConversationRowView = {
  id: string
  /** Identificador del contacto, siempre `psid <id>` (ADR 0005). */
  contactLabel: string
  /** `Café Rioja · 104233889761204`. */
  pageLabel: string
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
  /** `outbound · 14:02:11 · sent`. */
  meta: string
  /** Mensaje de fallo sanitizado por el contrato, solo en `failed`. */
  error: string | null
  /** Separador de fecha cuando el mensaje abre un día nuevo. */
  dayLabel: string | null
}

/** Texto del renglón principal cuando la conversación no tiene mensajes. */
export const NO_MESSAGES_CONTENT = "Todavía no hay mensajes."

const TIME_FORMAT = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
})

const SECONDS_FORMAT = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const DAY_FORMAT = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const SHORT_DAY_FORMAT = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
})

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

/** Identificador del contacto tal y como lo pinta el log, en mono. */
export function formatPsidLabel(contactId: string) {
  return `psid ${contactId}`
}

/** `Café Rioja · 104233889761204`. */
export function formatPageLabel(page: { name: string; metaPageId: string }) {
  return `${page.name} · ${page.metaPageId}`
}

/** `hoy 14:02` · `ayer 19:12` · `24 jul` · `24 jul 2025`. */
export function formatLogTimestamp(value: Date, now: Date) {
  const days = daysBetween(value, now)
  if (days === 0) return `hoy ${TIME_FORMAT.format(value)}`
  if (days === 1) return `ayer ${TIME_FORMAT.format(value)}`
  if (value.getFullYear() === now.getFullYear()) {
    return SHORT_DAY_FORMAT.format(value)
  }
  return DAY_FORMAT.format(value)
}

/** `27 jul 2026`, para el separador de fecha del hilo. */
export function formatDayLabel(value: Date) {
  return DAY_FORMAT.format(value)
}

/** `outbound · 14:02:11 · sent`, el patrón del metadato de burbuja. */
export function formatMessageMeta(message: {
  direction: string
  status: string
  createdAt: Date
}) {
  return `${message.direction} · ${SECONDS_FORMAT.format(message.createdAt)} · ${message.status}`
}

/** Renglón principal del log: el último mensaje, con `Tú: ` si es saliente. */
export function formatConversationContent(
  latestMessage: ConversationListItem["latestMessage"]
) {
  if (!latestMessage) return NO_MESSAGES_CONTENT
  const prefix = latestMessage.direction === "outbound" ? "Tú: " : ""
  return `${prefix}${latestMessage.text}`
}

/** Fila del log. `contactName` se ignora a propósito (ADR 0005). */
export function toConversationRowView(
  conversation: ConversationListItem,
  now: Date
): ConversationRowView {
  const { latestMessage } = conversation

  return {
    id: conversation.id,
    contactLabel: formatPsidLabel(conversation.contactId),
    pageLabel: formatPageLabel(conversation.page),
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

    return {
      id: message.id,
      outbound: message.direction === "outbound",
      failed,
      text: message.text,
      meta: formatMessageMeta(message),
      error: failed ? message.error : null,
      dayLabel: isNewDay ? dayLabel : null,
    }
  })
}

function daysBetween(value: Date, now: Date) {
  const start = startOfDay(value).getTime()
  const reference = startOfDay(now).getTime()
  return Math.round((reference - start) / 86_400_000)
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}
