import type { AttachmentDetails, InboundEvent } from "./inbound-event"
import { parseWhatsappWebhook } from "./whatsapp-parsers"
import type {
  WhatsappContactSyncEvent,
  WhatsappHistoryChunk,
  WhatsappMessageEvent,
  WhatsappStatusEvent,
  WhatsappTemplateEvent,
} from "./whatsapp-parsers"

// El enrutado del webhook de WhatsApp y el puente entre los tipos de los
// parsers y el evento neutro al canal (`inbound-event.ts`).
//
// Los parsers ya hicieron el trabajo difícil —cinco `field` distintos, tres
// formas de mensaje, ubicaciones y reacciones modeladas como adjunto— y son
// puros. Lo que falta es lo que la ingesta necesita: **una sola lista** de
// eventos que atraviesan los mismos gates, el mismo dedupe y el mismo contador
// que Messenger e Instagram, más lo que no es un mensaje (acuses, contactos,
// progreso del historial) devuelto aparte porque no se persiste como mensaje.
//
// Módulo aparte de `inbound-ingestion.ts` por la misma razón que
// `instagram-webhook.ts`: esto es traducción de formas, sin base de datos ni
// red, y se puede probar entero sin mockear nada.

export type WhatsappRoutedWebhook = {
  // Mensajes vivos, echoes de la Business App e historial, **en ese orden y
  // en una sola lista**. Los tres describen el mismo hecho —una fila de
  // `messages` con su wamid— y separarlos obligaría a la ingesta a repetir tres
  // veces la resolución de cuenta y los gates. Lo que los distingue viaja
  // adentro del evento (`origin`, `historical`, `direction`).
  events: InboundEvent[]
  // Los acuses no son mensajes: no crean fila, actualizan `delivery_status` de
  // una que ya existe. Van aparte porque `InboundEvent` no tiene forma de
  // expresar «esto no se persiste».
  statuses: WhatsappStatusEvent[]
  // El alta y baja de contactos del móvil del negocio. Se devuelven para que no
  // se pierdan; quien los persiste es el slice de Coexistence.
  contactSync: WhatsappContactSyncEvent[]
  // Los chunks completos, no solo sus mensajes: `progress === 100` es la única
  // señal documentada de que la sincronización terminó y viaja en el chunk.
  history: WhatsappHistoryChunk[]
  // Lo que Meta cuenta sobre las plantillas de la WABA: aprobaciones, rechazos,
  // recategorizaciones y caídas de calidad, en una sola lista discriminada por
  // `kind`. No son mensajes ni tocan una conversación —su efecto es un `update`
  // del espejo por `(waba_id, name, language)` (ADR 0014)—, pero sí son eventos
  // de este webhook, así que atraviesan este módulo en vez de leerse aparte del
  // batch: el que cablea la ingesta ya recibe todo lo del sobre por acá.
  templates: WhatsappTemplateEvent[]
  // `field`s que Meta manda y estos parsers no modelan. Se propagan para que la
  // ruta los registre: un campo nuevo tiene que aparecer en la bitácora, no
  // desaparecer.
  unhandledFields: string[]
}

export function routeWhatsappWebhook(body: unknown): WhatsappRoutedWebhook {
  const batch = parseWhatsappWebhook(body)

  return {
    // El orden importa dentro del mismo POST: si un wamid llegara a la vez como
    // histórico y como vivo, el vivo se persiste primero y el histórico rebota
    // contra el dedupe. La regla completa —un histórico nunca pisa a un vivo—
    // vive en el `on conflict` de `message-log.ts`, que es donde no se puede
    // esquivar; esto solo evita depender de ella en el caso fácil.
    events: [
      ...batch.messages.map(toInboundEvent),
      ...batch.echoes.map(toInboundEvent),
      ...batch.history.flatMap((chunk) => chunk.messages.map(toInboundEvent)),
    ],
    statuses: batch.statuses,
    contactSync: batch.contactSync,
    history: batch.history,
    templates: batch.templates,
    unhandledFields: batch.unhandledFields,
  }
}

/**
 * El puente. Un `WhatsappMessageEvent` (o un `WhatsappHistoryEvent`, que lo
 * extiende) contado en el vocabulario neutro de la ingesta.
 *
 * Las dos traducciones que no son un rename:
 *
 * - **`senderId` recibe `contactId`, no `senderId`.** En el evento neutro
 *   `senderId` es «el interlocutor de la conversación» —la ingesta lo usa como
 *   clave de `conversations` y como `messages.contact_id`—, y en WhatsApp ese
 *   es siempre el cliente, apunte donde apunte la dirección. En un echo el
 *   `senderId` del parser es el número del negocio: usarlo abriría una
 *   conversación del negocio consigo mismo.
 * - **`metaPageId` recibe `providerPhoneNumberId`.** Para este canal
 *   `connected_pages.meta_page_id` guarda el `phone_number_id` (0017 §2), así
 *   que la resolución de cuenta no necesita saber que el canal es distinto.
 */
export function toInboundEvent(event: WhatsappMessageEvent): InboundEvent {
  const attachment = event.attachment

  return {
    // WhatsApp no tiene postbacks: las respuestas a botones y a listas llegan
    // como `interactive`, que es un adjunto con sus datos en `details`. Inventar
    // aquí un `postback` obligaría a la UI a mirar dos formas de lo mismo.
    eventType: "message",
    metaPageId: event.providerPhoneNumberId,
    senderId: event.contactId,
    // El evento neutro promete string; el parser deja null cuando el mensaje no
    // trae texto propio (ubicación, pedido, evento de sistema).
    text: event.text ?? "",
    attachment: attachment
      ? {
          type: attachment.type,
          // Nunca la URL de Meta: dura 5 minutos y va autenticada. La del sobre
          // que sale al tenant apunta a nuestra ruta de media y la arma
          // `buildInboundPushPayload` con el id de la fila.
          url: null,
          title: attachment.title,
          // Mismo casteo que hace `attachmentFromRecord` en `external-push.ts`:
          // `details` es un jsonb de claves abiertas por diseño —cada tipo trae
          // las suyas— y `AttachmentDetails` es la vista tipada de las que el
          // código lee por nombre.
          details: attachment.details as AttachmentDetails,
        }
      : null,
    metaMessageId: event.metaMessageId,
    postbackPayload: null,
    timestamp: event.createdAt,
    direction: event.direction,
    origin: event.origin,
    historical: event.historical,
    deliveryStatus: event.deliveryStatus,
    attachmentStatus: attachment?.status ?? null,
    providerMediaId: attachment?.providerMediaId ?? null,
    replyToMetaMessageId: event.replyToMetaMessageId,
  }
}
