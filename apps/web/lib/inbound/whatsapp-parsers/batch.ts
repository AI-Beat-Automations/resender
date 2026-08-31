import { readContactSync } from "./app-state-sync"
import { readEchoes } from "./echoes"
import { collectChanges, withPhoneNumber } from "./envelope"
import { readHistory } from "./history"
import { readInboundMessages } from "./messages"
import { readStatuses } from "./statuses"
import {
  readTemplateCategoryUpdate,
  readTemplateQualityUpdate,
  readTemplateStatusUpdate,
} from "./templates"
import type {
  WhatsappContactSyncEvent,
  WhatsappHistoryChunk,
  WhatsappMessageEvent,
  WhatsappStatusEvent,
  WhatsappTemplateEvent,
  WhatsappWebhookBatch,
} from "./types"

// Entrada única de los parsers de WhatsApp. Recorre el lote una sola vez y lo
// agrupa por `field`: un `field` desconocido cae en el `default` y no impide
// que el resto del lote se procese, que es justo lo que no se consigue si cada
// consumidor filtra por su cuenta.
//
// Código puro: sin I/O, sin base de datos y sin llamadas a Meta —ni siquiera
// para resolver media—, porque el webhook se contesta con 200 antes de tocar
// nada.
export function parseWhatsappWebhook(value: unknown): WhatsappWebhookBatch {
  const batch: WhatsappWebhookBatch = {
    messages: [],
    statuses: [],
    history: [],
    contactSync: [],
    echoes: [],
    templates: [],
    unhandledFields: [],
  }

  const pushTemplate = (event: WhatsappTemplateEvent | null) => {
    if (event) batch.templates.push(event)
  }

  for (const change of collectChanges(value)) {
    // El lote mezcla dos ámbitos. Los cuatro campos de mensajería se atribuyen
    // a un número conectado por `metadata.phone_number_id`, y sin él no hay
    // tenant al que llevarlos: se descartan. Los tres de plantilla son de la
    // WABA y llegan sin ese campo (ADR 0014), así que exigírselo los borraría a
    // todos. `scoped` se calcula una vez y solo lo mira quien lo necesita.
    const scoped = withPhoneNumber(change)

    switch (change.field) {
      case "messages":
        if (!scoped) break
        // El mismo `field` trae mensajes entrantes y acuses de los que
        // enviamos nosotros, en dos arrays independientes que pueden venir a la
        // vez o faltar los dos (un `value` con solo `errors` es legal).
        batch.messages.push(...readInboundMessages(scoped))
        batch.statuses.push(...readStatuses(scoped))
        break
      case "history":
        if (!scoped) break
        batch.history.push(...readHistory(scoped))
        break
      case "smb_app_state_sync":
        if (!scoped) break
        batch.contactSync.push(...readContactSync(scoped))
        break
      case "smb_message_echoes":
        if (!scoped) break
        batch.echoes.push(...readEchoes(scoped))
        break
      // Los tres desembocan en la misma lista porque río abajo son el mismo
      // `update` del espejo por `(waba_id, name, language)`. El razonamiento
      // completo está en `WhatsappTemplateEvent`.
      case "message_template_status_update":
        pushTemplate(readTemplateStatusUpdate(change))
        break
      case "template_category_update":
        pushTemplate(readTemplateCategoryUpdate(change))
        break
      case "message_template_quality_update":
        pushTemplate(readTemplateQualityUpdate(change))
        break
      default:
        if (!batch.unhandledFields.includes(change.field)) {
          batch.unhandledFields.push(change.field)
        }
    }
  }

  return batch
}

// Los extractores por tipo de evento existen para que la ingesta (y los tests)
// puedan pedir una sola cosa sin destructurar el lote entero. Se apoyan en el
// mismo recorrido para que no haya dos definiciones de qué cuenta como mensaje
// válido.

export function extractWhatsappMessages(
  value: unknown
): WhatsappMessageEvent[] {
  return parseWhatsappWebhook(value).messages
}

export function extractWhatsappStatuses(value: unknown): WhatsappStatusEvent[] {
  return parseWhatsappWebhook(value).statuses
}

export function extractWhatsappHistory(value: unknown): WhatsappHistoryChunk[] {
  return parseWhatsappWebhook(value).history
}

export function extractWhatsappContactSync(
  value: unknown
): WhatsappContactSyncEvent[] {
  return parseWhatsappWebhook(value).contactSync
}

export function extractWhatsappEchoes(value: unknown): WhatsappMessageEvent[] {
  return parseWhatsappWebhook(value).echoes
}

export function extractWhatsappTemplates(
  value: unknown
): WhatsappTemplateEvent[] {
  return parseWhatsappWebhook(value).templates
}
