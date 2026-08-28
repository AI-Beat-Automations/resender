// Superficie pública de los parsers del webhook de WhatsApp Cloud API. Los
// módulos de dentro son detalle de implementación: quien cablea la ingesta
// importa de aquí y no de `messages.ts` o `content.ts`.

export {
  extractWhatsappContactSync,
  extractWhatsappEchoes,
  extractWhatsappHistory,
  extractWhatsappMessages,
  extractWhatsappStatuses,
  extractWhatsappTemplates,
  parseWhatsappWebhook,
} from "./batch"

export type {
  WhatsappAttachment,
  WhatsappContactSyncEvent,
  WhatsappError,
  WhatsappHistoryChunk,
  WhatsappHistoryEvent,
  WhatsappMessageEvent,
  WhatsappStatusEvent,
  WhatsappTemplateEvent,
  WhatsappTemplateRejection,
  WhatsappWebhookBatch,
} from "./types"
