import type { DeliveryStatus } from "@/lib/messages/message-enums"

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  normalizeTimestamp,
  samePhone,
} from "./coerce"
import { interpretMessage } from "./content"
import type { WhatsappChange } from "./envelope"
import { readErrors } from "./envelope"
import type { WhatsappHistoryChunk, WhatsappHistoryEvent } from "./types"

// `field: "history"`: la sincronización inicial de Coexistence, que importa
// hasta seis meses de conversaciones del móvil del negocio.

// El historial usa **MAYÚSCULAS** y un enum distinto del de `statuses[]`, con
// dos valores que allí no existen. Compartir la tabla de mapeo dejaría todo el
// historial sin estado de entrega y nadie se enteraría; por eso cada una vive
// en su módulo.
const DELIVERY_STATUS_BY_HISTORY_CONTEXT: Record<string, DeliveryStatus> = {
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
  // `PENDING` es "todavía no ha salido del móvil". `accepted` es el primer
  // estado de nuestro enum y el único que no afirma que Meta lo haya enviado.
  PENDING: "accepted",
}

export function readHistory(change: WhatsappChange): WhatsappHistoryChunk[] {
  const chunks: WhatsappHistoryChunk[] = []

  for (const raw of asArray(change.value.history)) {
    const chunk = asRecord(raw)
    if (!chunk) continue

    const metadata = asRecord(chunk.metadata)
    const messages: WhatsappHistoryEvent[] = []
    for (const rawThread of asArray(chunk.threads)) {
      const thread = asRecord(rawThread)
      if (!thread) continue
      const threadId = asString(thread.id)
      for (const rawMessage of asArray(thread.messages)) {
        const event = readHistoryMessage(change, asRecord(rawMessage), threadId)
        if (event) messages.push(event)
      }
    }

    chunks.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      phase: asNumber(metadata?.phase),
      chunkOrder: asNumber(metadata?.chunk_order),
      progress: asNumber(metadata?.progress),
      errors: readErrors(chunk.errors),
      messages,
    })
  }

  // La segunda forma del mismo `field`. Los mensajes multimedia del historial
  // llegan primero como `media_placeholder` sin ID de asset, y los IDs se
  // mandan después en webhooks aparte que **rompen la forma**: siguen siendo
  // `field: "history"` pero cuelgan de `value.messages[]`, no de
  // `value.history[]`. Por eso se discrimina por la presencia del array y no
  // por el `field`, y por eso el chunk resultante no tiene metadata que
  // reportar.
  //
  // Solo llega para los **últimos 14 días**: lo más antiguo se queda con el
  // placeholder, que sale de aquí con `attachment.status === "unavailable"`
  // para que el llamador lo marque y no encole ninguna descarga.
  //
  // El placeholder se conserva, pero **hoy nadie lo reconcilia**: la ingesta
  // solo sabe insertar, así que este segundo webhook trae el mismo `wamid` que
  // el placeholder, choca con el dedupe y se descarta — el multimedia del
  // historial se pierde. Casarlos por `wamid` es requisito del slice que active
  // Coexistence, junto con el de media.
  const mediaMessages: WhatsappHistoryEvent[] = []
  for (const raw of asArray(change.value.messages)) {
    const event = readHistoryMessage(change, asRecord(raw), null)
    if (event) mediaMessages.push(event)
  }
  if (mediaMessages.length > 0) {
    chunks.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      phase: null,
      chunkOrder: null,
      progress: null,
      errors: [],
      messages: mediaMessages,
    })
  }

  return chunks
}

function readHistoryMessage(
  change: WhatsappChange,
  message: Record<string, unknown> | null,
  threadId: string | null
): WhatsappHistoryEvent | null {
  const from = asString(message?.from)
  const metaMessageId = asString(message?.id)
  if (!message || !from || !metaMessageId) return null

  // El hilo ya identifica al interlocutor cuando viene. Cuando no —la forma de
  // IDs de media—, hay que deducirlo comparando contra el número del negocio,
  // que es el único referente disponible; `to` solo aparece en la sintaxis, no
  // en los ejemplos, así que no se puede depender de él.
  const contactId =
    threadId ??
    (samePhone(from, change.businessPhoneNumber) ? asString(message.to) : from)
  if (!contactId) return null

  const interpreted = interpretMessage(message)
  return {
    wabaId: change.wabaId,
    providerPhoneNumberId: change.providerPhoneNumberId,
    direction: samePhone(from, contactId) ? "inbound" : "outbound",
    contactId,
    senderId: from,
    contactName: null,
    metaMessageId,
    ...interpreted,
    replyToMetaMessageId: asString(asRecord(message.context)?.id),
    origin: "history",
    // Lo importado no abre ventana de 24 h ni se reenvía al webhook externo.
    historical: true,
    deliveryStatus: readHistoryDeliveryStatus(message.history_context),
    errors: readErrors(message.errors),
    // `<DEVICE_TIMESTAMP>`: la hora del móvil, no la del webhook. Es lo que
    // hace que el historial se ordene donde le toca y no todo junto al final.
    createdAt: normalizeTimestamp(message.timestamp),
    threadId,
  }
}

function readHistoryDeliveryStatus(value: unknown): DeliveryStatus | null {
  const reported = asString(asRecord(value)?.status)
  if (!reported) return null
  return DELIVERY_STATUS_BY_HISTORY_CONTEXT[reported] ?? null
}
