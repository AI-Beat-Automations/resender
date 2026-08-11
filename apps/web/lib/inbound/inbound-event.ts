// Evento entrante ya normalizado, **neutro al canal**. Es el contrato entre los
// parsers de webhook (uno por canal, porque los payloads no se parecen) y la
// ingesta (una sola, porque los gates, el dedupe, el contador y el reenvío al
// webhook del tenant sí son los mismos).
//
// Vive en su propio módulo y no en `meta-webhook.ts` porque desde Instagram hay
// dos productores: dejarlo del lado de Messenger haría que el parser de
// Instagram importara "el módulo de Messenger" para hablar de algo que no es de
// Messenger.

export type InboundEventType = "message" | "postback"

export type InboundEvent = {
  eventType: InboundEventType
  // Id de la cuenta que recibe, tal como llega en `entry.id`: page id en
  // Messenger, IG ID de la cuenta profesional en Instagram. Se resuelve contra
  // `connected_pages` junto con el canal, que lo aporta el llamador.
  metaPageId: string
  senderId: string
  text: string
  metaMessageId: string | null
  postbackPayload: string | null
  timestamp: Date
}
