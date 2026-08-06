import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import {
  countsTowardQuota,
  shouldPushInbound,
  type TenantEntitlement,
} from "@/lib/billing/entitlements"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { incrementUsage } from "@/lib/billing/usage-counter"
import {
  insertInboundMessage,
  upsertConversation,
  type MessageRecord,
} from "@/lib/messages/message-log"
import {
  getActivePageByMetaPageId,
  type ConnectedPageRecord,
  type PageChannel,
} from "@/lib/pages/page-registry"

import {
  insertInboundComment,
  isOwnPublishedComment,
} from "@/lib/comments/comment-log"

import {
  buildInboundCommentPayload,
  buildInboundPushPayload,
  pushInboundEvent,
  recordSkippedDelivery,
} from "./external-push"
import type { InboundEvent } from "./inbound-event"
import { extractInstagramComments } from "./instagram-comments"
import { extractInstagramDirectMessages } from "./instagram-webhook"
import { extractInboundEvents } from "./meta-webhook"
import { posthog } from "@/lib/posthog"

export type InboundPushJob = () => Promise<void>

// Lo único que el route handler necesita de un evento ingerido: la tarea de
// reenvío que corre fuera de la respuesta a Meta. Mensajes y comentarios la
// cumplen igual, así que la ruta no distingue entre unos y otros.
export type IngestedInbound = { pushJob: InboundPushJob }

export type IngestedInboundMessage = IngestedInbound & {
  page: ConnectedPageRecord
  message: MessageRecord
}

// Motivo del `skipped` cuando la cuenta está restringida (ADR 0003): el
// entrante se persiste y consume cuota, pero no se reenvía.
const RESTRICTED_SKIP_REASON =
  "account is restricted: quota exhausted or too many connected Pages"

// Instagram está **fuera de cuota y fuera del cupo de páginas** por ahora: sus
// entrantes no suman al contador del período ni se frenan cuando el tenant
// quedó restringido por su consumo de Messenger. El gate de suscripción activa
// sí aplica, y por eso está arriba y fuera de esta tabla.
//
// La consecuencia práctica es que en Instagram ni siquiera se resuelve el
// entitlement: sin contador que incrementar ni restricción que consultar, esa
// lectura sería una ida a la base por evento sin nada que decidir.
const CHANNEL_IS_METERED: Record<PageChannel, boolean> = {
  messenger: true,
  instagram: false,
}

// Entrada del webhook de Messenger.
export async function ingestMetaWebhookPayload(body: unknown) {
  return ingestInboundEvents(extractInboundEvents(body), "messenger")
}

// Entrada del webhook de Instagram: mensajes directos **y** comentarios.
//
// Un mismo POST de Meta puede traer las dos cosas, así que se procesan las dos
// y se devuelven juntas. La ruta solo ejecuta los `pushJob`, y le da igual de
// qué sujeto vienen.
//
// Los DMs comparten toda la ingesta con Messenger a propósito: cambia el
// payload —y por eso cambia el parser— pero no cambian el dedupe por índice, la
// resolución cuenta→tenant, el gate de suscripción, la bitácora de entregas ni
// la política de reintentos.
export async function ingestInstagramWebhookPayload(
  body: unknown
): Promise<IngestedInbound[]> {
  const [messages, comments] = await Promise.all([
    ingestInboundEvents(extractInstagramDirectMessages(body), "instagram"),
    ingestInstagramComments(body),
  ])

  return [...messages, ...comments]
}

async function ingestInboundEvents(
  incoming: InboundEvent[],
  channel: PageChannel
) {
  const ingested: IngestedInboundMessage[] = []
  // Un payload de Meta puede traer varios eventos del mismo tenant; el
  // entitlement se resuelve una sola vez por tenant y por payload.
  const entitlements = new Map<string, TenantEntitlement>()
  const metered = CHANNEL_IS_METERED[channel]

  for (const event of incoming) {
    // El canal viene del webhook que recibió el evento, no del payload: sin él,
    // un IG ID que coincida con un page id resolvería al tenant equivocado.
    const page = await getActivePageByMetaPageId(event.metaPageId, channel)
    if (!page) continue

    // Bloqueo total sin suscripción activa (ADR 0002): el entrante del tenant
    // se descarta sin persistir ni reenviar; esos mensajes se pierden a
    // propósito. El webhook responde 200 a Meta igualmente.
    if (!(await hasActiveSubscription(page.tenantId))) continue

    let entitlement: TenantEntitlement | null = null
    if (metered) {
      entitlement = entitlements.get(page.tenantId) ?? null
      if (!entitlement) {
        entitlement = await getTenantEntitlement(page.tenantId)
        entitlements.set(page.tenantId, entitlement)
      }
    }

    const conversation = await upsertConversation({
      tenantId: page.tenantId,
      connectedPageId: page.id,
      contactId: event.senderId,
      lastMessageAt: event.timestamp,
    })
    const { message, inserted } = await insertInboundMessage({
      tenantId: page.tenantId,
      conversationId: conversation.id,
      connectedPageId: page.id,
      contactId: event.senderId,
      text: event.text,
      metaMessageId: event.metaMessageId,
      createdAt: event.timestamp,
    })

    if (!inserted) continue

    // El entrante persistido consume cuota aunque la cuenta esté restringida o
    // la página no tenga `webhookUrl`: lo que se cobra es recibir y persistir,
    // no entregar. Best-effort — el contador nunca puede romper la ingesta.
    // En un canal sin medir no hay entitlement resuelto y no se cuenta nada.
    const periodStart = entitlement?.periodStart
    if (
      periodStart &&
      countsTowardQuota({ kind: "inbound", persisted: true })
    ) {
      try {
        await incrementUsage(page.tenantId, periodStart)
      } catch (error) {
        console.error("failed to increment usage counter", page.tenantId, error)
      }
    }

    if (posthog) {
      posthog.capture({
        distinctId: page.tenantId,
        event: "message received",
        properties: {
          message_id: message.id,
          conversation_id: conversation.id,
          page_id: page.metaPageId,
          channel,
          event_type: event.eventType,
        },
      })
      await posthog.flush()
    }

    const payload = buildInboundPushPayload({
      page,
      conversation,
      message,
      eventType: event.eventType,
      postbackPayload: event.postbackPayload,
    })
    const webhookUrl = page.webhookUrl
    const subject = { kind: "message", id: message.id } as const
    let pushJob: InboundPushJob
    // `entitlement` es null en un canal sin medir, y ahí la restricción por
    // consumo no aplica: el tenant que agotó su cuota de Messenger sigue
    // recibiendo sus DMs de Instagram.
    if (entitlement && !shouldPushInbound(entitlement)) {
      // Cuenta restringida (ADR 0003): el mensaje ya quedó persistido y
      // contabilizado, pero deja de reenviarse al webhook del cliente.
      pushJob = () => recordSkippedDelivery(subject, RESTRICTED_SKIP_REASON)
    } else if (webhookUrl) {
      pushJob = () => pushInboundEvent({ subject, webhookUrl, payload })
    } else {
      pushJob = () => recordSkippedDelivery(subject)
    }

    ingested.push({ page, message, pushJob })
  }

  return ingested
}

// Ingesta de comentarios. Mismo esqueleto que la de mensajes —resolver la
// cuenta, gate de suscripción, insertar con dedupe, reenviar— pero contra
// `instagram_comments`, que es otra tabla porque un comentario cuelga de una
// publicación y se anida (migración 0013).
//
// No lleva medición por la misma razón que los DMs de Instagram: el canal está
// fuera de cuota por ahora.
async function ingestInstagramComments(
  body: unknown
): Promise<IngestedInbound[]> {
  const incoming = extractInstagramComments(body)
  const ingested: IngestedInbound[] = []

  for (const event of incoming) {
    const page = await getActivePageByMetaPageId(event.metaPageId, "instagram")
    if (!page) continue

    // **Segunda comprobación anti-bucle.** El parser ya descartó los
    // comentarios cuyo `from.id` es la propia cuenta; acá se repite por
    // @handle, que es el otro dato que identifica a la cuenta y que el parser
    // no puede consultar porque vive en la base.
    //
    // Dos señales y no una porque de este filtro depende que el sistema no se
    // responda a sí mismo indefinidamente, y el costo de una comparación de
    // strings contra el costo de ese bucle no admite discusión.
    if (
      page.username &&
      event.fromUsername &&
      event.fromUsername.toLowerCase() === page.username.toLowerCase()
    ) {
      continue
    }

    // **Tercera comprobación anti-bucle**, la que la etapa 6 hizo posible. Las
    // dos anteriores leen el `from` que manda Meta; esta pregunta si el id del
    // comentario es uno que Resender publicó, que es un hecho nuestro y no una
    // interpretación de su payload.
    //
    // Va última porque es la única que consulta la base: las dos gratis cortan
    // antes y esta solo corre para los comentarios que llegaron hasta acá.
    if (
      await isOwnPublishedComment({
        connectedPageId: page.id,
        igCommentId: event.igCommentId,
      })
    ) {
      continue
    }

    // Bloqueo total sin suscripción activa (ADR 0002), igual que en los DMs: el
    // comentario se descarta sin persistir ni reenviar, y el webhook le
    // responde 200 a Meta igual.
    if (!(await hasActiveSubscription(page.tenantId))) continue

    const { comment, inserted } = await insertInboundComment({
      tenantId: page.tenantId,
      connectedPageId: page.id,
      igCommentId: event.igCommentId,
      parentIgCommentId: event.parentIgCommentId,
      mediaId: event.mediaId,
      mediaProductType: event.mediaProductType,
      fromIgId: event.fromIgId,
      fromUsername: event.fromUsername,
      text: event.text,
      createdAt: event.timestamp,
    })

    // Reintento de Meta o carrera entre dos requests: ya estaba, no se reenvía.
    if (!inserted) continue

    if (posthog) {
      posthog.capture({
        distinctId: page.tenantId,
        event: "instagram comment received",
        properties: {
          instagram_comment_id: comment.id,
          ig_comment_id: comment.igCommentId,
          media_id: comment.mediaId,
          page_id: page.metaPageId,
          is_reply: comment.parentIgCommentId !== null,
        },
      })
      await posthog.flush()
    }

    const payload = buildInboundCommentPayload({ page, comment })
    const subject = { kind: "comment", id: comment.id } as const
    const webhookUrl = page.webhookUrl

    ingested.push({
      pushJob: webhookUrl
        ? () => pushInboundEvent({ subject, webhookUrl, payload })
        : () => recordSkippedDelivery(subject),
    })
  }

  return ingested
}
