import { getCloudflareContext } from "@opennextjs/cloudflare"

import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import {
  shouldPushInbound,
  type TenantEntitlement,
} from "@/lib/billing/entitlements"
import { describeError, log } from "@/lib/observability/logger"
import {
  findActiveWhatsappConnectionIdInWaba,
  listActiveWhatsappWebhookConnectionsInWaba,
} from "@/lib/pages/page-registry"
import {
  applyWhatsappTemplateUpdate,
  type WhatsappTemplateEvent,
} from "@/lib/whatsapp-templates/template-store"

import {
  buildTemplatePushPayload,
  recordSkippedDelivery,
  type DeliveryLogContext,
  type DeliverySubject,
} from "./external-push"
import {
  FORWARDING_PAUSE_SKIP_REASON,
  resolveForwardingPause,
} from "./forwarding-pause"
import { enqueueDelivery } from "./webhook-delivery"
import type {
  WhatsappTemplateCategoryEvent,
  WhatsappTemplateQualityEvent,
  WhatsappTemplateRef,
  WhatsappTemplateStatusEvent,
} from "./whatsapp-parsers"

// La ingesta de los tres webhooks de plantillas de la WABA (issue #193).
//
// - **Estado:** actualiza la copia (`whatsapp_templates`) y, si el estado
//   cambió de verdad, reparte un evento `type: "template"` a cada conexión
//   activa con webhook de esa WABA, de cualquier tenant.
// - **Categoría:** solo actualiza la copia.
// - **Calidad:** solo va a logs, para enterarnos antes de que Meta pause.
//
// Mismo reparto de trabajo que los entrantes: la copia y la fila del evento se
// escriben antes del 200, y la entrega va en el `pushJob`, que la ruta corre en
// `after()`.

// Motivo del `skipped` cuando la cuenta está restringida: el mismo texto que
// en los entrantes (ADR 0003).
const RESTRICTED_SKIP_REASON =
  "account is restricted: quota exhausted or too many connected Pages"

export type IngestedTemplateDelivery = { pushJob: () => Promise<void> }

export async function ingestWhatsappTemplateEvents(input: {
  statuses: WhatsappTemplateStatusEvent[]
  categories: WhatsappTemplateCategoryEvent[]
  quality: WhatsappTemplateQualityEvent[]
  requestId: string
}): Promise<IngestedTemplateDelivery[]> {
  const deliveries: IngestedTemplateDelivery[] = []
  // Memos por lote, como en la ingesta de mensajes: el mismo tenant puede
  // tener varios números en la WABA.
  const memo: FanOutMemo = { access: new Map(), entitlements: new Map() }

  for (const event of input.statuses) {
    try {
      deliveries.push(
        ...(await applyStatusEvent(event, input.requestId, memo))
      )
    } catch (error) {
      // Una plantilla que falla no se lleva al resto del lote.
      log({
        entrypoint: "route",
        action: "template_status_update",
        outcome: "failed",
        reason: "internal_error",
        requestId: input.requestId,
        ...templateFields(event),
        errorMessage: describeError(error),
      })
    }
  }

  for (const event of input.categories) {
    try {
      await applyCategoryEvent(event, input.requestId)
    } catch (error) {
      log({
        entrypoint: "route",
        action: "template_category_update",
        outcome: "failed",
        reason: "internal_error",
        requestId: input.requestId,
        ...templateFields(event),
        errorMessage: describeError(error),
      })
    }
  }

  for (const event of input.quality) {
    // `warn` cuando empeora: es la señal que precede a una pausa de Meta.
    const worse = event.newQuality === "RED" || event.newQuality === "YELLOW"
    log({
      entrypoint: "route",
      action: "template_quality_update",
      outcome: "ok",
      ...(worse ? { level: "warn" as const } : {}),
      requestId: input.requestId,
      ...templateFields(event),
      ...(event.newQuality ? { templateQuality: event.newQuality } : {}),
      ...(event.previousQuality
        ? { previousTemplateQuality: event.previousQuality }
        : {}),
    })
  }

  return deliveries
}

type FanOutMemo = {
  access: Map<string, boolean>
  entitlements: Map<string, TenantEntitlement>
}

async function applyStatusEvent(
  event: WhatsappTemplateStatusEvent,
  requestId: string,
  memo: FanOutMemo
): Promise<IngestedTemplateDelivery[]> {
  // `FLAGGED`, `LOCKED`, `UNARCHIVED`: no son un estado y la copia no cambia.
  if (event.status === null) {
    if (event.needsResync) await enqueueWabaResync(event, requestId)
    log({
      entrypoint: "route",
      action: "template_status_update",
      outcome: "ok",
      requestId,
      ...templateFields(event),
      // El evento crudo, para saber cuál fue.
      templateStatus: event.event,
      count: 0,
    })
    return []
  }

  const applied = await applyWhatsappTemplateUpdate({
    wabaId: event.wabaId,
    metaTemplateId: event.metaTemplateId,
    name: event.name,
    language: event.language,
    status: event.status,
    category: event.category,
    reason: event.reason,
  })

  if (applied.kind !== "status_changed") {
    // El mismo estado otra vez (un reintento de Meta, o un `APPROVED` que el
    // sync ya había traído): no hay cambio que avisar.
    log({
      entrypoint: "route",
      action: "template_status_update",
      outcome: "duplicate",
      reason: "already_ingested",
      requestId,
      ...templateFields(event),
      templateStatus: event.status,
    })
    return []
  }

  const deliveries = await fanOutTemplateEvent(applied.event, requestId, memo)
  log({
    entrypoint: "route",
    action: "template_status_update",
    outcome: "ok",
    requestId,
    ...templateFields(event),
    subject: "template",
    subjectId: applied.event.id,
    templateStatus: applied.event.status,
    ...(applied.event.previousStatus
      ? { previousTemplateStatus: applied.event.previousStatus }
      : {}),
    // A cuántas conexiones se reparte el evento.
    count: deliveries.length,
  })
  return deliveries
}

// Un `pushJob` por conexión activa con webhook de la WABA. Mismos gates que un
// entrante y en el mismo orden: permiso de canal (descarta), cuenta
// restringida y pausa de la conexión (`skipped`, con su fila en la bitácora).
async function fanOutTemplateEvent(
  event: WhatsappTemplateEvent,
  requestId: string,
  memo: FanOutMemo
): Promise<IngestedTemplateDelivery[]> {
  const connections = await listActiveWhatsappWebhookConnectionsInWaba(
    event.wabaId
  )
  const deliveries: IngestedTemplateDelivery[] = []

  for (const page of connections) {
    const context: DeliveryLogContext = {
      requestId,
      tenantId: page.tenantId,
      connectionId: page.id,
      channel: "whatsapp",
      accountId: page.metaPageId,
      subject: "template",
      subjectId: event.id,
    }

    let hasAccess = memo.access.get(page.tenantId)
    if (hasAccess === undefined) {
      hasAccess = await resolveWhatsappAccess(page.tenantId)
      memo.access.set(page.tenantId, hasAccess)
    }
    if (!hasAccess) {
      log({
        entrypoint: "route",
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "channel_not_enabled",
        ...context,
      })
      continue
    }

    let entitlement = memo.entitlements.get(page.tenantId)
    if (!entitlement) {
      entitlement = await getTenantEntitlement(page.tenantId)
      memo.entitlements.set(page.tenantId, entitlement)
    }

    const subject: DeliverySubject = {
      kind: "template",
      id: event.id,
      connectionId: page.id,
    }
    const payload = buildTemplatePushPayload({ page, template: event })
    // Solo la pausa de la conexión: un cambio de plantilla no es de ninguna
    // conversación.
    const pause = resolveForwardingPause({
      connectionPausedAt: page.pausedAt,
      conversationPausedAt: null,
    })

    if (!shouldPushInbound(entitlement)) {
      deliveries.push({
        pushJob: () =>
          recordSkippedDelivery(subject, {
            reason: RESTRICTED_SKIP_REASON,
            logReason: "account_restricted",
            context,
            payload,
          }),
      })
    } else if (pause) {
      deliveries.push({
        pushJob: () =>
          recordSkippedDelivery(subject, {
            reason: FORWARDING_PAUSE_SKIP_REASON[pause],
            logReason: pause,
            context,
            payload,
          }),
      })
    } else if (page.webhookUrl) {
      const webhookUrl = page.webhookUrl
      deliveries.push({
        pushJob: () =>
          enqueueDelivery({ subject, webhookUrl, payload, context }),
      })
    }
  }

  return deliveries
}

async function applyCategoryEvent(
  event: WhatsappTemplateCategoryEvent,
  requestId: string
) {
  const fields = {
    requestId,
    ...templateFields(event),
    ...(event.category ? { templateCategory: event.category } : {}),
  }

  if (!event.category) {
    log({
      entrypoint: "route",
      action: "template_category_update",
      outcome: "dropped",
      reason: "invalid_request",
      ...fields,
    })
    return
  }

  const applied = await applyWhatsappTemplateUpdate({
    wabaId: event.wabaId,
    metaTemplateId: event.metaTemplateId,
    name: event.name,
    language: event.language,
    status: null,
    category: event.category,
    reason: null,
  })

  if (applied.kind === "not_found") {
    log({
      entrypoint: "route",
      action: "template_category_update",
      outcome: "dropped",
      reason: "template_not_found",
      ...fields,
    })
    return
  }

  log({
    entrypoint: "route",
    action: "template_category_update",
    outcome: "ok",
    // El aviso de que Meta la va a recategorizar en 24 h: la copia no cambia
    // todavía, pero conviene verlo.
    ...(event.upcomingCategory ? { level: "warn" as const } : {}),
    ...fields,
  })
}

// `UNARCHIVED`: Meta dice que la plantilla volvió a su estado anterior sin
// decir cuál. En vez de adivinarlo se vuelve a traer el catálogo de la WABA.
async function enqueueWabaResync(
  event: WhatsappTemplateStatusEvent,
  requestId: string
) {
  try {
    const connectionId = await findActiveWhatsappConnectionIdInWaba(
      event.wabaId
    )
    if (!connectionId) return
    await getCloudflareContext().env.WHATSAPP_JOBS.send({
      type: "template_sync",
      connectionId,
    })
  } catch (error) {
    log({
      entrypoint: "route",
      action: "template_sync",
      outcome: "failed",
      reason: "internal_error",
      requestId,
      ...templateFields(event),
      errorMessage: describeError(error),
    })
  }
}

function templateFields(ref: WhatsappTemplateRef) {
  return {
    channel: "whatsapp" as const,
    accountId: ref.wabaId,
    templateName: ref.name,
    templateLanguage: ref.language,
  }
}
