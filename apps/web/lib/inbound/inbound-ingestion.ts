import { resolveInstagramAccess } from "@/lib/auth/channel-access"
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
import { accountFields, describeError, log } from "@/lib/observability/logger"
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

// **Todos los canales se miden** (ADR 0011). La tabla `CHANNEL_IS_METERED` que
// vivía acá declaraba a Instagram fuera de cuota y fuera del cupo, y con ella
// desaparece la rama `entitlement === null`: un entrante de Instagram —DM o
// comentario— suma al contador del período y deja de reenviarse cuando el
// tenant quedó [Cuenta restringida], exactamente igual que uno de Messenger.
// No queda tabla porque una con todos los valores en `true` no decide nada;
// el día que un canal deje de medirse, vuelve.
//
// El permiso por cuenta (ADR 0010) es de Instagram y de nadie más: Messenger no
// tiene bandera y su ingesta no cambia en absoluto. Va como tabla y no como un
// `channel === "instagram"` para que, cuando entre WhatsApp —bloqueado por Meta
// por la misma razón—, el tipo obligue a decidir.
const CHANNEL_NEEDS_PERMISSION: Record<PageChannel, boolean> = {
  messenger: false,
  instagram: true,
}

// Memo del permiso por tenant **dentro del lote**: un POST de Meta trae varios
// eventos de la misma cuenta y la lectura es viva contra la base, así que sin
// esto sería una consulta por evento.
//
// La ausencia se pregunta con `undefined` y no con `?? null` como el memo de
// entitlements: acá el valor cacheado puede ser `false`, y un memo que confunde
// «todavía no pregunté» con «pregunté y no tiene permiso» consulta de más hoy y
// se equivoca de lado el día que alguien lo invierta.
async function resolveCachedInstagramAccess(
  cache: Map<string, boolean>,
  tenantId: string
): Promise<boolean> {
  const cached = cache.get(tenantId)
  if (cached !== undefined) return cached

  const enabled = await resolveInstagramAccess(tenantId)
  cache.set(tenantId, enabled)
  return enabled
}

// Mismo memo por lote para el entitlement: un POST de Meta trae varios eventos
// del mismo tenant y resolverlo es una lectura contra la base. Vive como
// función y no inline desde que los comentarios también lo resuelven (ADR
// 0011), para que las dos ingestas memoicen igual y no se separen.
async function resolveCachedEntitlement(
  cache: Map<string, TenantEntitlement>,
  tenantId: string
): Promise<TenantEntitlement> {
  const cached = cache.get(tenantId)
  if (cached) return cached

  const entitlement = await getTenantEntitlement(tenantId)
  cache.set(tenantId, entitlement)
  return entitlement
}

// Entrada del webhook de Messenger.
export async function ingestMetaWebhookPayload(
  body: unknown,
  requestId: string
) {
  return ingestInboundEvents(extractInboundEvents(body), "messenger", requestId)
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
  body: unknown,
  requestId: string
): Promise<IngestedInbound[]> {
  const [messages, comments] = await Promise.all([
    ingestInboundEvents(
      extractInstagramDirectMessages(body),
      "instagram",
      requestId
    ),
    ingestInstagramComments(body, requestId),
  ])

  return [...messages, ...comments]
}

// El `requestId` se genera en la ruta y viaja como parámetro hasta el closure
// del `pushJob`, que es lo que lo cruza al `after()` —donde la entrega corre
// **después** de que ya se respondió—. Es lo que permite reconstruir un POST
// entero: el sobre, sus N eventos y sus N entregas, con un solo filtro.
async function ingestInboundEvents(
  incoming: InboundEvent[],
  channel: PageChannel,
  requestId: string
) {
  const ingested: IngestedInboundMessage[] = []
  // Un payload de Meta puede traer varios eventos del mismo tenant; el
  // entitlement se resuelve una sola vez por tenant y por payload.
  const entitlements = new Map<string, TenantEntitlement>()
  // Un memo por función y no uno compartido con los comentarios:
  // `ingestInstagramWebhookPayload` corre las dos ingestas con `Promise.all`, y
  // compartirlo obligaría a pasarlo por parámetro —tocando la firma que también
  // sirve a Messenger— para ahorrar, en el peor caso, una lectura por payload.
  const instagramAccess = new Map<string, boolean>()

  for (const event of incoming) {
    // El canal viene del webhook que recibió el evento, no del payload: sin él,
    // un IG ID que coincida con un page id resolvería al tenant equivocado.
    const page = await getActivePageByMetaPageId(event.metaPageId, channel)
    if (!page) {
      // El descarte más probable de todos, y hasta ahora mudo. El `channel` va
      // en la línea porque desde la 0013 el mismo id existe en los dos canales:
      // «cuenta no encontrada» sin decir dónde se buscó no se puede investigar.
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "account_not_connected",
        requestId,
        channel,
        accountId: event.metaPageId,
        subject: "message",
      })
      continue
    }

    // Bloqueo total sin suscripción activa (ADR 0002): el entrante del tenant
    // se descarta sin persistir ni reenviar; esos mensajes se pierden a
    // propósito. El webhook responde 200 a Meta igualmente.
    if (!(await hasActiveSubscription(page.tenantId))) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "no_active_subscription",
        requestId,
        ...accountFields(page),
        subject: "message",
      })
      continue
    }

    // Permiso por cuenta del canal (ADR 0010): el tenant revocado deja de
    // recibir en el acto y su DM se descarta sin persistir ni reenviar, igual
    // que sin suscripción. Solo puede pasar por revocación —el gate del OAuth
    // impide conectar sin permiso—, y por eso va después del portón que sí se
    // cruza todos los días.
    if (
      CHANNEL_NEEDS_PERMISSION[channel] &&
      !(await resolveCachedInstagramAccess(instagramAccess, page.tenantId))
    ) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "channel_not_enabled",
        requestId,
        ...accountFields(page),
        subject: "message",
      })
      continue
    }

    const entitlement = await resolveCachedEntitlement(
      entitlements,
      page.tenantId
    )

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
      // El adjunto viaja tal como lo normalizó el parser; el merge del `title`
      // dentro del jsonb lo hace `insertInboundMessage`, y el split inverso lo
      // hace `buildInboundPushPayload` — un solo mapeo, en un solo lugar.
      attachment: event.attachment
        ? {
            type: event.attachment.type,
            url: event.attachment.url,
            title: event.attachment.title,
            details: event.attachment.details,
          }
        : null,
      createdAt: event.timestamp,
    })

    const subject = { kind: "message", id: message.id } as const
    const logSubject = {
      subject: "message",
      subjectId: message.id,
      providerId: event.metaMessageId ?? undefined,
      contactId: event.senderId,
    } as const

    if (!inserted) {
      // Reintento de Meta o carrera entre dos requests. No es un error, pero sí
      // la diferencia entre «no llegó» y «llegó y ya estaba».
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "duplicate",
        reason: "already_ingested",
        requestId,
        ...accountFields(page),
        ...logSubject,
      })
      continue
    }

    log({
      entrypoint: "route",
      action: "inbound_ingest",
      outcome: "ok",
      requestId,
      ...accountFields(page),
      ...logSubject,
      // El texto no se loguea nunca; el largo alcanza para distinguir «llegó
      // vacío» de «llegó» sin guardar lo que dijo nadie. Del adjunto se loguea
      // solo el tipo —nunca la URL, que apunta a contenido del usuario— y el
      // conteo de descartados cuando el contacto mandó varios de una vez.
      textLength: event.text.length,
      ...(event.attachment
        ? {
            attachmentType: event.attachment.type,
            ...(event.attachment.details.droppedCount
              ? { droppedCount: event.attachment.details.droppedCount }
              : {}),
          }
        : {}),
    })

    // El entrante persistido consume cuota aunque la cuenta esté restringida o
    // la página no tenga `webhookUrl`: lo que se cobra es recibir y persistir,
    // no entregar. Best-effort — el contador nunca puede romper la ingesta.
    // Sin período resuelto no hay ventana contra la cual contar (fail-closed
    // del módulo puro), y ahí el entrante entra igual pero no suma.
    const periodStart = entitlement.periodStart
    if (
      periodStart &&
      countsTowardQuota({ kind: "inbound", persisted: true })
    ) {
      try {
        await incrementUsage(page.tenantId, periodStart)
      } catch (error) {
        log({
          entrypoint: "route",
          action: "usage_increment",
          outcome: "failed",
          reason: "usage_counter_failed",
          requestId,
          ...accountFields(page),
          errorMessage: describeError(error),
        })
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
    // El contexto de log viaja adentro del closure: cuando el `pushJob` corre,
    // la request ya terminó y no hay de dónde volver a sacarlo.
    const deliveryContext = { requestId, ...accountFields(page), ...logSubject }
    let pushJob: InboundPushJob
    if (!shouldPushInbound(entitlement)) {
      // Cuenta restringida (ADR 0003): el mensaje ya quedó persistido y
      // contabilizado, pero deja de reenviarse al webhook del cliente.
      pushJob = () =>
        recordSkippedDelivery(subject, {
          reason: RESTRICTED_SKIP_REASON,
          logReason: "account_restricted",
          context: deliveryContext,
        })
    } else if (webhookUrl) {
      pushJob = () =>
        pushInboundEvent({
          subject,
          webhookUrl,
          payload,
          context: deliveryContext,
        })
    } else {
      pushJob = () =>
        recordSkippedDelivery(subject, { context: deliveryContext })
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
// Lleva medición como los DMs (ADR 0011) y sin asteriscos: un comentario
// entrante persistido suma 1 al contador del período y deja de reenviarse
// cuando el tenant está restringido. La consecuencia comercial está dicha en la
// ADR: un post con muchos comentarios puede quemar la cuota de un mes.
async function ingestInstagramComments(
  body: unknown,
  requestId: string
): Promise<IngestedInbound[]> {
  const incoming = extractInstagramComments(body)
  const ingested: IngestedInbound[] = []
  // Mismos memos por lote que en los DMs, y propios de esta función por la
  // razón que está explicada allá.
  const instagramAccess = new Map<string, boolean>()
  const entitlements = new Map<string, TenantEntitlement>()

  for (const event of incoming) {
    const page = await getActivePageByMetaPageId(event.metaPageId, "instagram")
    if (!page) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "account_not_connected",
        requestId,
        channel: "instagram",
        accountId: event.metaPageId,
        subject: "comment",
        providerId: event.igCommentId,
      })
      continue
    }

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
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "self_authored_comment",
        requestId,
        ...accountFields(page),
        subject: "comment",
        providerId: event.igCommentId,
      })
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
      // Motivo propio y no un `anti_loop` genérico compartido con la señal
      // anterior: son señales **independientes** a propósito, y si una deja de
      // disparar hay que poder ver cuál quedó sosteniendo el filtro sola.
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "own_published_comment",
        requestId,
        ...accountFields(page),
        subject: "comment",
        providerId: event.igCommentId,
      })
      continue
    }

    // Bloqueo total sin suscripción activa (ADR 0002), igual que en los DMs: el
    // comentario se descarta sin persistir ni reenviar, y el webhook le
    // responde 200 a Meta igual.
    if (!(await hasActiveSubscription(page.tenantId))) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "no_active_subscription",
        requestId,
        ...accountFields(page),
        subject: "comment",
        providerId: event.igCommentId,
      })
      continue
    }

    // Permiso por cuenta del canal (ADR 0010), igual que en los DMs: el
    // comentario del tenant revocado se descarta sin persistir ni reenviar. Va
    // después de los tres filtros anti-bucle a propósito: un comentario nuestro
    // que vuelve tiene que seguir contándose como eco y no como revocación.
    if (!(await resolveCachedInstagramAccess(instagramAccess, page.tenantId))) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "channel_not_enabled",
        requestId,
        ...accountFields(page),
        subject: "comment",
        providerId: event.igCommentId,
      })
      continue
    }

    const entitlement = await resolveCachedEntitlement(
      entitlements,
      page.tenantId
    )

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

    const logSubject = {
      subject: "comment",
      subjectId: comment.id,
      providerId: comment.igCommentId ?? event.igCommentId,
      contactId: comment.fromIgId,
    } as const

    // Reintento de Meta o carrera entre dos requests: ya estaba, no se reenvía.
    if (!inserted) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "duplicate",
        reason: "already_ingested",
        requestId,
        ...accountFields(page),
        ...logSubject,
      })
      continue
    }

    log({
      entrypoint: "route",
      action: "inbound_ingest",
      outcome: "ok",
      requestId,
      ...accountFields(page),
      ...logSubject,
      textLength: event.text.length,
    })

    // Un comentario entrante persistido cuenta igual que un DM (ADR 0011), con
    // la misma regla y el mismo best-effort: el contador nunca puede romper la
    // ingesta de algo que Meta ya nos entregó.
    const periodStart = entitlement.periodStart
    if (
      periodStart &&
      countsTowardQuota({ kind: "inbound", persisted: true })
    ) {
      try {
        await incrementUsage(page.tenantId, periodStart)
      } catch (error) {
        log({
          entrypoint: "route",
          action: "usage_increment",
          outcome: "failed",
          reason: "usage_counter_failed",
          requestId,
          ...accountFields(page),
          errorMessage: describeError(error),
        })
      }
    }

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
    const context = { requestId, ...accountFields(page), ...logSubject }

    // Cuenta restringida (ADR 0003, extendida a Instagram por la 0011): el
    // comentario ya quedó persistido y contabilizado, pero deja de reenviarse
    // al webhook del cliente. Gana sobre el `webhookUrl` por lo mismo que en
    // los DMs: la restricción es del tenant, no de la conexión.
    const pushJob: InboundPushJob = !shouldPushInbound(entitlement)
      ? () =>
          recordSkippedDelivery(subject, {
            reason: RESTRICTED_SKIP_REASON,
            logReason: "account_restricted",
            context,
          })
      : webhookUrl
        ? () => pushInboundEvent({ subject, webhookUrl, payload, context })
        : () => recordSkippedDelivery(subject, { context })

    ingested.push({ pushJob })
  }

  return ingested
}
