import {
  resolveInstagramAccess,
  resolveWhatsappAccess,
} from "@/lib/auth/channel-access"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import {
  countsTowardQuota,
  shouldPushInbound,
  type TenantEntitlement,
} from "@/lib/billing/entitlements"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { incrementUsage } from "@/lib/billing/usage-counter"
import {
  insertCoexistenceMessage,
  insertInboundMessage,
  updateDeliveryStatus,
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
  recordSkippedDelivery,
} from "./external-push"
// La entrega dejó de ocurrir acá: `enqueueDelivery` escribe el job y encola. El
// reenvío en sí pasa en el consumidor de la cola (`worker.ts`), fuera del techo
// de 30 s de `after()`.
import { enqueueDelivery } from "./webhook-delivery"
import type { InboundEvent } from "./inbound-event"
import { extractInstagramComments } from "./instagram-comments"
import { extractInstagramDirectMessages } from "./instagram-webhook"
import { extractInboundEvents } from "./meta-webhook"
import { routeWhatsappWebhook } from "./whatsapp-webhook"
import type { WhatsappStatusEvent } from "./whatsapp-parsers"
import { accountFields, describeError, log } from "@/lib/observability/logger"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { captureDeferred } from "@/lib/posthog"

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
// El permiso por cuenta (ADR 0010) lo tienen Instagram y WhatsApp, cada uno con
// su bandera: los dos están implementados y a ninguno le concedió Meta todavía
// el Advanced Access. Messenger no tiene bandera y su ingesta no cambia.
//
// Va como tabla —y no como `channel === "instagram" || channel === "whatsapp"`—
// para que el canal que entre después obligue a decidir en vez de colarse por
// el `else`. Es una sola tabla y no dos (una de «¿necesita permiso?» y otra de
// «¿cómo se resuelve?») porque dos tablas sobre la misma clave dicen lo mismo
// dos veces y se desincronizan: acá `null` **es** «este canal no tiene gate».
const CHANNEL_ACCESS_RESOLVER: Record<
  PageChannel,
  ((tenantId: string) => Promise<boolean>) | null
> = {
  messenger: null,
  instagram: resolveInstagramAccess,
  whatsapp: resolveWhatsappAccess,
}

// Memo del permiso por tenant **dentro del lote**: un POST de Meta trae varios
// eventos de la misma cuenta y la lectura es viva contra la base, así que sin
// esto sería una consulta por evento.
//
// La clave lleva el canal además del tenant porque las banderas son dos y son
// independientes: un tenant puede tener Instagram y no WhatsApp, y un memo
// indexado solo por tenant le contestaría al segundo con la respuesta del
// primero.
//
// La ausencia se pregunta con `undefined` y no con `?? null` como el memo de
// entitlements: acá el valor cacheado puede ser `false`, y un memo que confunde
// «todavía no pregunté» con «pregunté y no tiene permiso» consulta de más hoy y
// se equivoca de lado el día que alguien lo invierta.
async function resolveCachedChannelAccess(
  cache: Map<string, boolean>,
  channel: PageChannel,
  tenantId: string
): Promise<boolean> {
  const resolve = CHANNEL_ACCESS_RESOLVER[channel]
  if (!resolve) return true

  const key = `${channel}:${tenantId}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const enabled = await resolve(tenantId)
  cache.set(key, enabled)
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

// Entrada del webhook de WhatsApp Cloud API.
//
// Un mismo POST puede traer las cinco cosas que Meta manda por este canal, y
// las tres que producen filas —mensajes vivos, echoes de la Business App e
// historial importado— entran por la **misma** ingesta que Messenger e
// Instagram: los mismos gates en el mismo orden, el mismo dedupe y el mismo
// contador. Lo que cambia por canal es el parser, no la política.
//
// Los acuses van después de los mensajes a propósito: si en el mismo lote viene
// un mensaje y su `status`, el UPDATE encuentra la fila que el insert acaba de
// escribir en vez de tocar cero filas.
export async function ingestWhatsappWebhookPayload(
  body: unknown,
  requestId: string
): Promise<IngestedInbound[]> {
  const routed = routeWhatsappWebhook(body)

  const ingested = await ingestInboundEvents(
    routed.events,
    "whatsapp",
    requestId
  )
  await applyWhatsappStatuses(routed.statuses, requestId)

  if (routed.unhandledFields.length > 0) {
    // Un `field` que Meta manda y los parsers no modelan (`account_update`,
    // `message_template_status_update`, `calls`…) tiene que aparecer en la
    // bitácora, no desaparecer: es la señal de que hay algo nuevo que atender.
    //
    // El motivo se reusa del catálogo cerrado de `logger.ts` —el más cercano a
    // «esto llegó y no produjo eventos»— porque agregar uno propio significa
    // tocar un archivo que este slice no toca. Los `fields` de la línea dicen
    // exactamente cuáles fueron.
    log({
      entrypoint: "route",
      action: "webhook_receive",
      outcome: "dropped",
      reason: "no_events_in_payload",
      requestId,
      channel: "whatsapp",
      fields: routed.unhandledFields,
    })
  }

  return ingested
}

// Los acuses de entrega. No crean fila: mueven `delivery_status` de una que ya
// existe, así que no pasan por la ingesta de mensajes ni devuelven `pushJob`.
//
// Mismos gates y en el mismo orden que un mensaje —cuenta, suscripción,
// permiso de canal—: un tenant sin suscripción o con el canal revocado deja de
// recibir en el acto, y eso incluye dejar de escribirle la fila.
async function applyWhatsappStatuses(
  statuses: WhatsappStatusEvent[],
  requestId: string
) {
  const channelAccess = new Map<string, boolean>()

  for (const status of statuses) {
    const logSubject = {
      subject: "message",
      providerId: status.metaMessageId,
      ...(status.recipientId ? { contactId: status.recipientId } : {}),
    } as const

    const page = await getActivePageByMetaPageId(
      status.providerPhoneNumberId,
      "whatsapp"
    )
    if (!page) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "account_not_connected",
        requestId,
        channel: "whatsapp",
        accountId: status.providerPhoneNumberId,
        ...logSubject,
      })
      continue
    }

    if (!(await hasActiveSubscription(page.tenantId))) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "no_active_subscription",
        requestId,
        ...accountFields(page),
        ...logSubject,
      })
      continue
    }

    if (
      !(await resolveCachedChannelAccess(
        channelAccess,
        "whatsapp",
        page.tenantId
      ))
    ) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "channel_not_enabled",
        requestId,
        ...accountFields(page),
        ...logSubject,
      })
      continue
    }

    const applied = await updateDeliveryStatus({
      connectedPageId: page.id,
      metaMessageId: status.metaMessageId,
      deliveryStatus: status.deliveryStatus,
    })

    if (!applied) {
      // El callback perdió la guarda del UPDATE: o llegó atrasado (un `sent`
      // después del `read` del mismo wamid, que Meta entrega desordenado), o es
      // un reintento del que ya se aplicó, o el wamid no es de una fila nuestra.
      // Los tres se descartan igual: no hay dato que mostrar, hay una
      // inconsistencia de Meta. Queda la métrica para poder verla.
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
    })
  }
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
  const channelAccess = new Map<string, boolean>()

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
      !(await resolveCachedChannelAccess(channelAccess, channel, page.tenantId))
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

    // Ausente = entrante, que es lo único que producen Messenger e Instagram.
    // WhatsApp sí manda salientes por webhook: el eco de la Business App y la
    // mitad saliente del historial.
    const direction = event.direction ?? "inbound"

    const conversation = await upsertConversation({
      tenantId: page.tenantId,
      connectedPageId: page.id,
      contactId: event.senderId,
      lastMessageAt: event.timestamp,
      // El mensaje entero y no un `lastInboundAt` ya calculado: la regla de la
      // ventana de 24 h es estado derivado y vive en
      // `opensCustomerServiceWindow`. Duplicarla acá sería la segunda copia que
      // se desincroniza sola.
      message: {
        direction,
        historical: event.historical,
        origin: event.origin,
      },
    })

    const persist = {
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
      origin: event.origin,
      historical: event.historical,
      deliveryStatus: event.deliveryStatus,
      attachmentStatus: event.attachmentStatus,
      replyToMetaMessageId: event.replyToMetaMessageId,
      createdAt: event.timestamp,
    }

    // Dos inserts y no uno con parámetro porque deduplican contra **índices
    // únicos distintos**: el de la 0001 solo cubre `direction='inbound'` y el
    // saliente con wamid —echoes e historial— necesita el de la 0017 §7. El
    // predicado del `on conflict` va escrito literal en cada consulta (el
    // driver HTTP de Neon no arma fragmentos `sql` anidados).
    const { message, inserted } =
      direction === "outbound"
        ? await insertCoexistenceMessage(persist)
        : await insertInboundMessage(persist)

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

    // La descarga del binario, encolada y **no** hecha acá: la URL de Meta dura
    // 5 minutos pero bajarla puede tardar (un documento llega hasta 100 MB) y a
    // Meta hay que contestarle el 200 antes. Va pegado a la persistencia porque
    // es parte de dejar la fila completa, y antes de la cuota para no depender
    // de si el tenant tiene período resuelto.
    //
    // Solo `pending` encola. `unavailable` es «Meta nunca ofreció el binario»
    // —el multimedia del historial de más de 14 días— y ya quedó escrito en la
    // fila: encolarle una descarga sería reintentar para siempre algo que no
    // existe.
    if (event.attachmentStatus === "pending" && event.providerMediaId) {
      await enqueueMediaDownload({
        messageId: message.id,
        providerMediaId: event.providerMediaId,
        requestId,
        page,
      })
    }

    // El entrante persistido consume cuota aunque la cuenta esté restringida o
    // la página no tenga `webhookUrl`: lo que se cobra es recibir y persistir,
    // no entregar. Best-effort — el contador nunca puede romper la ingesta.
    // Sin período resuelto no hay ventana contra la cual contar (fail-closed
    // del módulo puro), y ahí el entrante entra igual pero no suma.
    //
    // **La única excepción declarada a «todos los canales se miden» (ADR 0011)
    // es el historial**, y está acá: un mensaje con `historical=true` es un
    // backfill de una conversación que ocurrió **fuera** de Resender y que
    // además decidimos no entregarle al webhook del tenant. Cobrar por algo que
    // no se entrega no se puede defender, y sin la excepción un Starter podría
    // quedarse sin cuota el mismo día que conecta su número (el sync importa
    // hasta 180 días de conversaciones). Los echoes de la Business App **sí**
    // cuentan: son tráfico vivo y sí se reenvían.
    const periodStart = entitlement.periodStart
    if (
      periodStart &&
      !event.historical &&
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

    // El historial no llega más lejos: ni analítica ni reenvío. Un import son
    // miles de mensajes de hasta 180 días de antigüedad, y contarlos como
    // «message received» convertiría el día de la conexión en un pico que no
    // ocurrió. El corte va después de la persistencia y de la cuota para que se
    // lea en el orden en que pasan las cosas: se guarda, no se cobra, no sale.
    if (event.historical) continue

    captureDeferred({
      distinctId: page.tenantId,
      event: "message received",
      properties: {
        message_id: message.id,
        conversation_id: conversation.id,
        page_id: page.metaPageId,
        channel,
        event_type: event.eventType,
        // Distingue el eco de la Business App de un entrante del cliente sin
        // tener que cruzar la fila: son dos hechos comerciales distintos.
        ...(event.origin ? { origin: event.origin } : {}),
      },
    })

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
        enqueueDelivery({
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

// El alta del job de descarga de media en la cola propia de WhatsApp.
//
// Cola separada de `webhook-deliveries` a propósito: un import de historial son
// miles de jobs y en la cola de entregas competirían en batches de 10 con los
// pushes de todos los tenants.
//
// Un fallo al encolar **no** rompe la ingesta ni pierde el mensaje: la fila
// queda en `attachment_status='pending'`, que es exactamente lo que busca el
// índice parcial `messages_attachment_pending_idx` de la 0017, así que es
// recuperable. Lo que no puede pasar es que se caiga en silencio, y por eso
// queda la línea.
async function enqueueMediaDownload(input: {
  messageId: string
  providerMediaId: string
  requestId: string
  page: ConnectedPageRecord
}) {
  try {
    await getCloudflareContext().env.WHATSAPP_JOBS.send({
      type: "media_download",
      messageId: input.messageId,
      providerMediaId: input.providerMediaId,
    })
  } catch (error) {
    log({
      entrypoint: "route",
      action: "inbound_ingest",
      outcome: "failed",
      reason: "internal_error",
      requestId: input.requestId,
      ...accountFields(input.page),
      subject: "message",
      subjectId: input.messageId,
      errorMessage: describeError(error),
    })
  }
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
  const channelAccess = new Map<string, boolean>()
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
    if (
      !(await resolveCachedChannelAccess(
        channelAccess,
        "instagram",
        page.tenantId
      ))
    ) {
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

    captureDeferred({
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
        ? () => enqueueDelivery({ subject, webhookUrl, payload, context })
        : () => recordSkippedDelivery(subject, { context })

    ingested.push({ pushJob })
  }

  return ingested
}
