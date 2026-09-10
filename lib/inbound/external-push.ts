import { getSql } from "@/lib/db"
import type { InstagramCommentRecord } from "@/lib/comments/comment-log"
import type {
  ConversationRecord,
  MessageDirection,
  MessageRecord,
  MessageStatus,
} from "@/lib/messages/message-log"
import type {
  AttachmentStatus,
  DeliveryStatus,
  MessageAttachmentType,
  MessageOrigin,
} from "@/lib/messages/message-enums"
import { effectiveStatus } from "@/lib/messages/media-retention"
import type { WhatsappOnboardingMode } from "@/lib/meta/whatsapp-client"
import type {
  ConnectedPageRecord,
  PageChannel,
} from "@/lib/pages/page-registry"
import { log, type LogReason } from "@/lib/observability/logger"
import type {
  AttachmentDetails,
  InboundAttachment,
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
    // Los tres de WhatsApp. **Solo aparecen cuando el canal es WhatsApp**, no
    // como null en los otros dos: el sobre de Messenger tiene que salir
    // byte a byte como salía —hay clientes consumiéndolo hoy— y un
    // `phoneNumberId: null` en un mensaje de Facebook no informa nada, solo
    // obliga a leer el canal para saber que hay que ignorarlo.
    //
    // `phoneNumberId` es el mismo valor que `metaPageId` en este canal (0017
    // §2). Se repite con su nombre real porque "meta page id" no es el nombre
    // de nada del lado de WhatsApp, y el consumidor lo va a cruzar contra lo
    // que ve en el panel de Meta.
    phoneNumberId?: string
    wabaId?: string | null
    onboardingMode?: WhatsappOnboardingMode | null
  }
  conversation: { id: string; contactId: string }
  message: {
    id: string
    metaMessageId: string | null
    eventType: InboundEventType
    postbackPayload: string | null
    // Ensanchados, no bifurcados: en WhatsApp el webhook trae también salientes
    // —el eco de lo que el negocio escribió desde la Business App— y el sobre
    // sigue siendo el mismo. Para Messenger e Instagram el valor no cambia.
    direction: MessageDirection
    status: MessageStatus
    text: string
    // Siempre presente, null explícito cuando el mensaje no trajo adjunto: el
    // consumidor no tiene que adivinar si la clave falta o si no hubo adjunto.
    // Aditivo: `text` sigue siendo string (`""` cuando no hubo texto).
    attachment: InboundAttachment | null
    createdAt: string
    // Los cuatro de WhatsApp, con el mismo criterio que los de `page`.
    // `origin` es lo que le permite al consumidor no automatizarse sobre sí
    // mismo: `business_app` es el negocio escribiendo desde su móvil, no una
    // respuesta nuestra.
    origin?: MessageOrigin | null
    // Siempre `false` en lo que se pushea: el historial no se entrega nunca.
    // Va igual, explícito, para que el contrato diga qué significa su ausencia
    // el día que alguien lo lea al revés.
    historical?: boolean
    replyToProviderMessageId?: string | null
    deliveryStatus?: DeliveryStatus | null
  }
}

export function buildInboundPushPayload(input: {
  page: ConnectedPageRecord
  conversation: ConversationRecord
  message: MessageRecord
  eventType: InboundEventType
  postbackPayload: string | null
  // Solo para derivar el vencimiento de la media a los 180 días. Va como
  // parámetro y no como `new Date()` adentro para que el test pueda pararse el
  // día 181 sin tocar el reloj del proceso.
  now?: Date
}): InboundPushPayload {
  // **El sobre no se bifurca por canal** (PRD, "Entrega al webhook externo"):
  // es el mismo `{type, tenant, page, conversation, message}` y el mismo
  // `attachment` singular que ya consumen los clientes de Messenger. Lo único
  // que hace este flag es no ensuciar los otros dos canales con seis claves que
  // ahí no significan nada — y garantizar que su payload salga byte por byte
  // como salía antes de que WhatsApp existiera.
  const isWhatsapp = input.page.channel === "whatsapp"
  const message = input.message

  return {
    type: "message",
    tenant: { id: message.tenantId },
    page: {
      id: input.page.id,
      channel: input.page.channel,
      metaPageId: input.page.metaPageId,
      name: input.page.name,
      username: input.page.username,
      ...(isWhatsapp
        ? {
            phoneNumberId: input.page.metaPageId,
            wabaId: input.page.wabaId,
            onboardingMode: input.page.onboardingMode,
          }
        : {}),
    },
    conversation: {
      id: input.conversation.id,
      contactId: input.conversation.contactId,
    },
    message: {
      id: message.id,
      metaMessageId: message.metaMessageId,
      eventType: input.eventType,
      postbackPayload: input.postbackPayload,
      // Del registro y no literales: en WhatsApp un eco de la Business App es
      // `outbound`/`sent`. En los otros dos canales la fila siempre trae
      // `inbound`/`received`, que es lo que se mandaba escrito a mano.
      direction: message.direction,
      status: message.status,
      text: message.text,
      attachment: attachmentFromRecord(message, {
        channel: input.page.channel,
        now: input.now ?? new Date(),
      }),
      createdAt: message.createdAt.toISOString(),
      ...(isWhatsapp
        ? {
            origin: message.origin ?? null,
            historical: message.historical ?? false,
            replyToProviderMessageId: message.replyToMetaMessageId ?? null,
            deliveryStatus: message.deliveryStatus ?? null,
          }
        : {}),
    },
  }
}

// Ruta propia por la que el tenant baja el binario. Es nuestra y no la de Meta
// a propósito: la de Meta dura 5 minutos, va autenticada con nuestro token y
// no se puede volver a pedir. Esta pide la API key del tenant y sirve desde R2.
function whatsappMediaUrl(messageId: string): string | null {
  // Se lee en cada llamada y no como constante de módulo: `lib/meta.ts` la
  // captura al importar y eso obliga a stubbear el entorno en cada test que
  // roce este archivo. Sin `APP_URL` no hay URL que dar, y una relativa sería
  // peor que ninguna: el consumidor la resolvería contra su propio host.
  const base = process.env.APP_URL?.replace(/\/+$/, "")
  if (!base) return null
  return `${base}/api/meta/whatsapp/media/${messageId}`
}

// Reconstruye el adjunto desde la fila persistida. Es el split inverso EXACTO
// del merge que hace `insertInboundMessage` —que guarda `details` más la clave
// `title` en `attachment_meta`—, para que lo que se guarda y lo que se pushea
// sean el mismo objeto: un solo mapeo, sin segunda fuente de verdad.
function attachmentFromRecord(
  message: MessageRecord,
  options: { channel: PageChannel; now: Date }
): InboundAttachment | null {
  if (!message.attachmentType) return null

  const meta = message.attachmentMeta ?? {}
  const { title, ...details } = meta
  const attachment: InboundAttachment = {
    // El check `messages_attachment_type_check` (0017 §6) garantiza que lo
    // guardado está en el catálogo; el cast solo se lo recuerda al compilador.
    type: message.attachmentType as MessageAttachmentType,
    url: message.attachmentUrl,
    title: typeof title === "string" ? title : null,
    details: details as AttachmentDetails,
  }

  if (options.channel !== "whatsapp") return attachment

  // En WhatsApp `attachment_url` está siempre vacía —la URL de Meta no se
  // persiste— y el estado del binario es un dato **derivado**: la columna dice
  // qué pasó con la descarga y la edad de la fila dice si ya venció, porque el
  // borrado a los 180 días lo hace la lifecycle rule del bucket y no un update
  // nuestro (`lib/messages/media-retention.ts`). Con dos relojes habría un
  // estado guardado que miente.
  //
  // `null` es "este adjunto no tiene binario": ubicación, contacto, reacción,
  // respuesta interactiva. No hay nada que bajar y por tanto no hay URL.
  const status: AttachmentStatus | null = message.attachmentStatus
    ? effectiveStatus(
        {
          attachment_status: message.attachmentStatus,
          created_at: message.createdAt,
        },
        options.now
      )
    : null

  // `unavailable` (Meta nunca lo ofreció) y `deleted` (lo tuvimos y venció) son
  // los dos casos en los que el archivo no va a existir nunca más: la URL va
  // null para que el cliente no reintente contra un 404 eterno. `pending` y
  // `failed` sí la llevan —el primero porque va a llegar, el segundo porque el
  // reintento manual es legítimo—, y el estado dice qué esperar.
  const retrievable =
    status !== null && status !== "unavailable" && status !== "deleted"

  return {
    ...attachment,
    url: retrievable ? whatsappMediaUrl(message.id) : null,
    // Solo se agrega la clave cuando hay estado: un adjunto sin binario no
    // gana un `status: null` que el consumidor tendría que interpretar.
    details: status ? { ...attachment.details, status } : attachment.details,
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
