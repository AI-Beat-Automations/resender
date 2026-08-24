import {
  formatDayLabel,
  formatLogTimestamp,
  formatMessageMeta,
} from "@/lib/inbox/log-format"
import {
  type AttachmentDisplay,
  toAttachmentDisplay,
  whatsappMediaUrl,
} from "@/lib/inbox/message-media"
import type { PageChannel } from "@/lib/pages/page-registry"

import { effectiveStatus } from "./media-retention"
import type { AttachmentStatus, DeliveryStatus } from "./message-enums"
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

export type ThreadReactionView = {
  /** Id del mensaje-reacción, para la key de React. */
  id: string
  /** El emoji tal como lo mandó WhatsApp. */
  emoji: string
  /** La puso el negocio (saliente) y no el cliente. */
  outbound: boolean
}

export type ThreadMessageView = {
  id: string
  outbound: boolean
  failed: boolean
  /** Puede ser `""`: un mensaje solo-adjunto no trae texto. */
  text: string
  /** Qué pintar por el adjunto (preview o fila); null si el mensaje no trae. */
  attachment: AttachmentDisplay | null
  /** `outbound · 14:02:11 · sent`, con `· respuesta a comentario` si lo es. */
  meta: string
  /** El saliente es la respuesta privada a un comentario de Instagram. */
  fromComment: boolean
  /**
   * Lo que reporta Meta sobre la entrega, ya en castellano y prefijado
   * (`entrega: leído`). Es **otra cosa** que el `status` interno que va en
   * `meta`, y por eso va en su propio campo y lleva el prefijo: `sent` interno
   * significa «lo mandamos a Meta» y `delivered` significa «llegó al teléfono».
   * Null en Messenger e Instagram, que no reportan entrega.
   */
  delivery: string | null
  /** Reacciones colgadas de este mensaje; nunca burbujas propias. */
  reactions: ThreadReactionView[]
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
  whatsappPhoneE164?: string | null
}) {
  if (page.channel === "instagram" && page.username) {
    return `@${page.username} · ig_id ${page.metaPageId}`
  }
  // Mismo criterio en WhatsApp: `metaPageId` acá es el `phone_number_id`, un
  // entero opaco. Lo que el usuario reconoce es el número; el id es lo que cita
  // en soporte. Sin número —fila vieja o alta a medio hacer— cae al nombre.
  if (page.channel === "whatsapp" && page.whatsappPhoneE164) {
    return `${page.whatsappPhoneE164} · phone_number_id ${page.metaPageId}`
  }
  return `${page.name} · ${page.metaPageId}`
}

/** Renglón principal del log: el último mensaje, con `Tú: ` si es saliente. */
export function formatConversationContent(
  latestMessage: ConversationListItem["latestMessage"]
) {
  if (!latestMessage) return NO_MESSAGES_CONTENT
  const prefix = latestMessage.direction === "outbound" ? "Tú: " : ""
  // Un mensaje solo-adjunto llega con texto vacío: el renglón muestra el type
  // entre corchetes (`[image]`) en su lugar. Con texto, el renglón no cambia
  // — el adjunto se descubre al abrir el hilo.
  const body =
    latestMessage.text === "" && latestMessage.attachmentType
      ? `[${latestMessage.attachmentType}]`
      : latestMessage.text
  return `${prefix}${body}`
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

// Cómo se lee en castellano cada estado de entrega que reporta Meta. Es un
// `Record` sobre la unión y no un `switch` con default: el estado nuevo no
// compila hasta que alguien decida cómo se dice.
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  accepted: "aceptado",
  sent: "enviado",
  delivered: "entregado",
  read: "leído",
  failed: "no entregado",
  deleted: "eliminado",
}

/**
 * `entrega: leído`, o null si el proveedor todavía no dijo nada.
 *
 * El prefijo no es decoración. En la burbuja conviven dos palabras que se
 * parecen y no significan lo mismo: el `status` interno (`sent` = «se lo
 * mandamos a Meta») y el `delivery_status` (`sent` = «Meta lo mandó al
 * teléfono», `delivered` = «llegó»). Sin el prefijo, un hilo con `sent · sent`
 * es indescifrable; con él, cada uno dice de qué habla.
 */
export function formatDeliveryLabel(
  deliveryStatus: DeliveryStatus | null
): string | null {
  if (!deliveryStatus) return null
  return `entrega: ${DELIVERY_STATUS_LABEL[deliveryStatus]}`
}

export type ReactionGrouping = {
  /** Los mensajes que llevan burbuja propia, en el orden que entraron. */
  timeline: ThreadMessage[]
  /** Reacciones por id del mensaje al que apuntan. */
  reactionsByMessageId: Record<string, ThreadReactionView[]>
}

/**
 * Separa las reacciones del hilo y las cuelga del mensaje al que apuntan.
 *
 * Una reacción **no es un mensaje**: WhatsApp la manda como una fila más, con
 * su propio wamid y su `reply_to_meta_message_id` apuntando al mensaje
 * reaccionado. Dibujarla como burbuja propia parte la conversación en dos —«ok»,
 * «👍», «dale»— y hace ilegible un hilo donde la gente reacciona seguido.
 *
 * Tres reglas, y las tres tienen su motivo:
 *
 * 1. **Emoji vacío es una reacción retirada.** WhatsApp no manda un evento de
 *    borrado: manda la misma reacción con el emoji en blanco. Tratarla como una
 *    reacción más dejaría un chip fantasma sin contenido.
 * 2. **Si el mensaje reaccionado no está en el hilo, la reacción sí lleva
 *    burbuja.** Pasa con lo anterior al import de historial, o con un target que
 *    todavía no bajó. Es feo, pero desaparecer en silencio es peor: el dato
 *    existe y el usuario tiene derecho a verlo.
 * 3. **El emparejamiento es por `meta_message_id`, no por posición.** Es el
 *    único id que las dos filas comparten; el nuestro (`id`) no viaja a Meta.
 */
export function groupThreadReactions(
  messages: ThreadMessage[]
): ReactionGrouping {
  const byMetaId = new Map<string, ThreadMessage>()
  for (const message of messages) {
    if (message.metaMessageId) byMetaId.set(message.metaMessageId, message)
  }

  const timeline: ThreadMessage[] = []
  const reactionsByMessageId: Record<string, ThreadReactionView[]> = {}

  for (const message of messages) {
    if (message.attachmentType !== "reaction") {
      timeline.push(message)
      continue
    }

    const emoji = reactionEmoji(message)
    // Retirada: ni chip ni burbuja. No hay nada que mostrar.
    if (!emoji) continue

    const target = message.replyToMetaMessageId
      ? byMetaId.get(message.replyToMetaMessageId)
      : undefined

    if (!target) {
      timeline.push(message)
      continue
    }

    const view: ThreadReactionView = {
      id: message.id,
      emoji,
      outbound: message.direction === "outbound",
    }
    reactionsByMessageId[target.id] = [
      ...(reactionsByMessageId[target.id] ?? []),
      view,
    ]
  }

  return { timeline, reactionsByMessageId }
}

// El emoji viaja en el meta del adjunto; la caída al texto cubre a quien lo
// persista ahí. Vacío en los dos lados = reacción retirada.
function reactionEmoji(message: ThreadMessage): string {
  const fromMeta = message.attachmentMeta?.emoji
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim()
  return message.text.trim()
}

/**
 * De dónde baja el adjunto de este mensaje y en qué estado está.
 *
 * En Messenger e Instagram no hay estado y la URL es la del CDN de Meta, tal
 * como se persistió. En WhatsApp la URL **nunca** es de Meta —la firmada de
 * Cloud API dura cinco minutos— sino la ruta propia que sirve la copia de R2, y
 * el estado se **deriva** de la edad de la fila con `effectiveStatus` en vez de
 * leerse crudo: si lo leyéramos crudo habría dos relojes, el de la lifecycle
 * rule del bucket y el nuestro, y tarde o temprano se separan.
 */
function resolveAttachmentSource(
  message: ThreadMessage,
  now: Date
): { url: string | null; status: AttachmentStatus | null } {
  if (message.channel !== "whatsapp" || !message.attachmentStatus) {
    return { url: message.attachmentUrl, status: null }
  }

  const status = effectiveStatus(
    {
      attachment_status: message.attachmentStatus,
      created_at: message.createdAt,
    },
    now
  )

  return { url: whatsappMediaUrl({ messageId: message.id, status }), status }
}

/**
 * Hilo completo. El separador de fecha se resuelve aquí porque depende del
 * mensaje anterior, no del mensaje suelto.
 *
 * `now` entra por parámetro y no se toma adentro para que el vencimiento de la
 * media sea testeable: la regla de los 180 días depende de la hora, y una
 * función que consulta el reloj por su cuenta no se puede fijar en un test.
 */
export function toThreadMessageViews(
  messages: ThreadMessage[],
  now: Date = new Date()
): ThreadMessageView[] {
  let previousDay: string | null = null
  // Las reacciones se resuelven antes del recorrido: una reacción puede llegar
  // después del mensaje que reacciona, así que hay que ver el hilo entero para
  // saber qué lleva burbuja y qué no.
  const { timeline, reactionsByMessageId } = groupThreadReactions(messages)

  return timeline.map((message) => {
    const dayLabel = formatDayLabel(message.createdAt)
    const isNewDay = dayLabel !== previousDay
    previousDay = dayLabel
    const failed = message.status === "failed"
    // El sufijo se compone acá y no en `formatMessageMeta`, que ahora lo
    // comparten los dos modos de Inbox: un comentario nunca es respuesta
    // privada de nada.
    const fromComment = message.instagramSourceCommentId !== null
    const source = resolveAttachmentSource(message, now)

    return {
      id: message.id,
      outbound: message.direction === "outbound",
      failed,
      text: message.text,
      // El adjunto se resuelve acá y no en el componente: la regla de preview
      // vs fila vive en `message-media.ts`, que sí corre bajo Vitest.
      attachment: message.attachmentType
        ? toAttachmentDisplay({
            type: message.attachmentType,
            url: source.url,
            meta: message.attachmentMeta,
            status: source.status,
          })
        : null,
      meta: fromComment
        ? `${formatMessageMeta(message)} · respuesta a comentario`
        : formatMessageMeta(message),
      fromComment,
      delivery: formatDeliveryLabel(message.deliveryStatus),
      reactions: reactionsByMessageId[message.id] ?? [],
      error: failed ? message.error : null,
      dayLabel: isNewDay ? dayLabel : null,
    }
  })
}
