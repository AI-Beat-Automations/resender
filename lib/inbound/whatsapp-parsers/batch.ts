import { readContactSync } from "./app-state-sync"
import { readEchoes } from "./echoes"
import { collectChanges } from "./envelope"
import { readHistory } from "./history"
import { readInboundMessages } from "./messages"
import { readStatuses } from "./statuses"
import type {
  WhatsappContactSyncEvent,
  WhatsappHistoryChunk,
  WhatsappMessageEvent,
  WhatsappStatusEvent,
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
    unhandledFields: [],
  }

  for (const change of collectChanges(value)) {
    switch (change.field) {
      case "messages":
        // El mismo `field` trae mensajes entrantes y acuses de los que
        // enviamos nosotros, en dos arrays independientes que pueden venir a la
        // vez o faltar los dos (un `value` con solo `errors` es legal).
        batch.messages.push(...readInboundMessages(change))
        batch.statuses.push(...readStatuses(change))
        break
      case "history":
        batch.history.push(...readHistory(change))
        break
      case "smb_app_state_sync":
        batch.contactSync.push(...readContactSync(change))
        break
      case "smb_message_echoes":
        batch.echoes.push(...readEchoes(change))
        break
      default:
        if (!batch.unhandledFields.includes(change.field)) {
          batch.unhandledFields.push(change.field)
        }
    }
  }

  return batch
}

// Los cinco extractores por tipo de evento existen para que la ingesta (y los
// tests) puedan pedir una sola cosa sin destructurar el lote entero. Se apoyan
// en el mismo recorrido para que no haya dos definiciones de qué cuenta como
// mensaje válido.

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
