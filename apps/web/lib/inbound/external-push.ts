import { getSql } from "@/lib/db"
import type { InstagramCommentRecord } from "@/lib/comments/comment-log"
import type {
  ConversationRecord,
  MessageRecord,
} from "@/lib/messages/message-log"
import type {
  ConnectedPageRecord,
  PageChannel,
} from "@/lib/pages/page-registry"
import { log, type LogReason } from "@/lib/observability/logger"
import type {
  AttachmentDetails,
  InboundAttachment,
  InboundAttachmentType,
  InboundEventType,
} from "./inbound-event"

// Re-exportados junto a `InboundPushPayload`: el consumidor del payload tipa
// el adjunto desde acá sin tener que conocer el módulo interno de eventos.
export type { AttachmentDetails, InboundAttachment } from "./inbound-event"

// Sujeto de la entrega. `external_webhook_deliveries` acepta desde la migración
// 0013 un mensaje **o** un comentario, con un check de que sea exactamente uno;
// este tipo es esa restricción expresada en TypeScript, para que no se pueda
// construir una entrega sin sujeto ni con los dos.
export type DeliverySubject =
  | { kind: "message"; id: string }
  | { kind: "comment"; id: string }

export type InboundPushPayload = {
  // Discrimina el tipo de evento sin que el consumidor tenga que adivinar por
  // qué claves trae el objeto. Un tenant recibe mensajes y comentarios en el
  // mismo endpoint, y `switch (payload.type)` es todo lo que necesita.
  type: "message"
  tenant: { id: string }
  // `channel` y `username` son campos nuevos y siempre presentes, también en
  // Messenger (`username` va null ahí). Un tenant con los dos canales apuntando
  // al mismo webhook necesita distinguir de cuál vino el mensaje, y una forma
  // uniforme es más fácil de consumir que una que cambia según el canal.
  // Agregar campos es compatible: los consumidores existentes los ignoran.
  page: {
    id: string
    channel: PageChannel
    metaPageId: string
    name: string
    username: string | null
  }
  conversation: { id: string; contactId: string }
  message: {
    id: string
    metaMessageId: string | null
    eventType: InboundEventType
    postbackPayload: string | null
    direction: "inbound"
    status: "received"
    text: string
    // Siempre presente, null explícito cuando el mensaje no trajo adjunto: el
    // consumidor no tiene que adivinar si la clave falta o si no hubo adjunto.
    // Aditivo: `text` sigue siendo string (`""` cuando no hubo texto).
    attachment: InboundAttachment | null
    createdAt: string
  }
}

export function buildInboundPushPayload(input: {
  page: ConnectedPageRecord
  conversation: ConversationRecord
  message: MessageRecord
  eventType: InboundEventType
  postbackPayload: string | null
}): InboundPushPayload {
  return {
    type: "message",
    tenant: { id: input.message.tenantId },
    page: {
      id: input.page.id,
      channel: input.page.channel,
      metaPageId: input.page.metaPageId,
      name: input.page.name,
      username: input.page.username,
    },
    conversation: {
      id: input.conversation.id,
      contactId: input.conversation.contactId,
    },
    message: {
      id: input.message.id,
      metaMessageId: input.message.metaMessageId,
      eventType: input.eventType,
      postbackPayload: input.postbackPayload,
      direction: "inbound",
      status: "received",
      text: input.message.text,
      attachment: attachmentFromRecord(input.message),
      createdAt: input.message.createdAt.toISOString(),
    },
  }
}

// Reconstruye el adjunto desde la fila persistida. Es el split inverso EXACTO
// del merge que hace `insertInboundMessage` —que guarda `details` más la clave
// `title` en `attachment_meta`—, para que lo que se guarda y lo que se pushea
// sean el mismo objeto: un solo mapeo, sin segunda fuente de verdad.
function attachmentFromRecord(
  message: MessageRecord
): InboundAttachment | null {
  if (!message.attachmentType) return null

  const meta = message.attachmentMeta ?? {}
  const { title, ...details } = meta
  return {
    // El check `messages_attachment_type_check` (0016) garantiza que lo
    // guardado está en el catálogo; el cast solo se lo recuerda al compilador.
    type: message.attachmentType as InboundAttachmentType,
    url: message.attachmentUrl,
    title: typeof title === "string" ? title : null,
    details: details as AttachmentDetails,
  }
}

export type InboundCommentPushPayload = {
  type: "comment"
  tenant: { id: string }
  page: {
    id: string
    channel: PageChannel
    metaPageId: string
    name: string
    username: string | null
  }
  comment: {
    id: string
    igCommentId: string | null
    // Informado si el comentario responde a otro. Es lo que le permite al
    // consumidor reconstruir el hilo sin volver a consultar a Meta.
    parentIgCommentId: string | null
    mediaId: string
    mediaProductType: string | null
    from: { igId: string; username: string | null }
    direction: "inbound"
    status: "received"
    text: string
    createdAt: string
  }
}

export function buildInboundCommentPayload(input: {
  page: ConnectedPageRecord
  comment: InstagramCommentRecord
}): InboundCommentPushPayload {
  return {
    type: "comment",
    tenant: { id: input.comment.tenantId },
    page: {
      id: input.page.id,
      channel: input.page.channel,
      metaPageId: input.page.metaPageId,
      name: input.page.name,
      username: input.page.username,
    },
    comment: {
      id: input.comment.id,
      igCommentId: input.comment.igCommentId,
      parentIgCommentId: input.comment.parentIgCommentId,
      mediaId: input.comment.mediaId,
      mediaProductType: input.comment.mediaProductType,
      from: {
        igId: input.comment.fromIgId,
        username: input.comment.fromUsername,
      },
      direction: "inbound",
      status: "received",
      text: input.comment.text,
      createdAt: input.comment.createdAt.toISOString(),
    },
  }
}

export type PushPayload = InboundPushPayload | InboundCommentPushPayload

// Contexto de log de una entrega. Viaja desde la ingesta adentro del closure
// del `pushJob`, porque cuando este código corre —en el `after()` de Next— la
// request ya terminó y no hay de dónde volver a resolver la cuenta.
//
// **No incluye el `webhookUrl` a propósito.** Es una URL que controla el
// cliente y puede llevar un token en el path; las de n8n rutinariamente lo
// hacen. `connectionId` alcanza para saber cuál era.
export type DeliveryLogContext = {
  requestId?: string
  tenantId?: string
  connectionId?: string
  channel?: PageChannel
  accountId?: string
  accountHandle?: string
  subject?: "message" | "comment"
  subjectId?: string
  providerId?: string
  contactId?: string
}

// El motivo es parametrizable porque hay más de una razón para no entregar: la
// página sin `webhookUrl` y la cuenta restringida (ADR 0003), que persiste el
// entrante pero deja de reenviarlo.
export async function recordSkippedDelivery(
  subject: DeliverySubject,
  options: {
    // El texto que va a la columna `error` de la bitácora, que ya existía y es
    // legible por humanos.
    reason?: string
    // El motivo del catálogo cerrado, que es el que se filtra en el panel. Van
    // separados porque uno es prosa histórica y el otro es una faceta.
    logReason?: Extract<
      LogReason,
      "webhook_url_not_configured" | "account_restricted"
    >
    context?: DeliveryLogContext
  } = {}
) {
  const reason = options.reason ?? "webhookUrl not configured"
  await recordDelivery({
    subject,
    webhookUrl: null,
    status: "skipped",
    statusCode: null,
    error: reason,
    attempt: 1,
  })
  log({
    entrypoint: "after",
    action: "webhook_delivery",
    outcome: "skipped",
    reason: options.logReason ?? "webhook_url_not_configured",
    ...options.context,
  })
}

// La escritura en la bitácora de intentos. Es pública porque la comparte el
// alta del job (`webhook-delivery.ts`): una URL inválida se registra igual, sin
// llegar a encolarse.
export async function recordDelivery(input: {
  subject: DeliverySubject
  webhookUrl: string | null
  status: "skipped" | "success" | "failed"
  statusCode: number | null
  error: string | null
  attempt: number
}) {
  const sql = getSql()
  // Exactamente una de las dos columnas va informada; la otra es null. El check
  // `num_nonnulls(...) = 1` de la migración 0013 rechaza cualquier otra cosa, y
  // el tipo `DeliverySubject` hace que no se pueda llegar hasta acá con las dos.
  const messageId = input.subject.kind === "message" ? input.subject.id : null
  const commentId = input.subject.kind === "comment" ? input.subject.id : null

  await sql`
    insert into external_webhook_deliveries (
      message_id,
      instagram_comment_id,
      webhook_url,
      status,
      status_code,
      error,
      attempt
    )
    values (
      ${messageId},
      ${commentId},
      ${input.webhookUrl},
      ${input.status},
      ${input.statusCode},
      ${input.error},
      ${input.attempt}
    )
  `
}
