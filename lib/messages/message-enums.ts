import { INBOUND_ATTACHMENT_TYPES } from "@/lib/inbound/inbound-event"

// Los enums de la fila de `messages`, en TypeScript plano. No son esquemas de
// validación: la fuente de verdad son los `check` de las migraciones —la 0016
// para `attachment_type` y la 0017 para el resto—, y esto es lo que impide que
// el código escriba un valor que la base va a rechazar en el insert.

// Catálogo de `attachment_type` (`messages_attachment_type_check`, 0017 §6).
//
// Se construye **extendiendo** `INBOUND_ATTACHMENT_TYPES` en vez de copiarlo:
// la migración declara que los dos catálogos son el mismo y que se tocan
// juntos, y una tercera copia literal es una tercera cosa que se desincroniza
// sola. Lo que WhatsApp agrega son los seis de abajo, que en Messenger e
// Instagram no existen.
//
// Ojo con el vocabulario: el `document` de WhatsApp entra como `file`, que ya
// estaba en el catálogo. Son el mismo concepto con dos nombres y sumar el
// segundo obligaría a mirar los dos en cada rama de la UI.
export const MESSAGE_ATTACHMENT_TYPES = [
  ...INBOUND_ATTACHMENT_TYPES,
  "location",
  "contacts",
  "reaction",
  "interactive",
  "order",
  "system",
] as const

export type MessageAttachmentType = (typeof MESSAGE_ATTACHMENT_TYPES)[number]

// Quién produjo el mensaje. `direction` no alcanza en Coexistence: un saliente
// puede ser nuestro (API) o el eco de algo tecleado en la WhatsApp Business
// App, y el webhook externo necesita distinguirlos para no automatizarse sobre
// sí mismo. `history` marca lo importado en la sync inicial.
export const MESSAGE_ORIGINS = [
  "customer",
  "resender_api",
  "business_app",
  "history",
  "system",
] as const

export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number]

// Estado que reporta el proveedor, separado del `status` interno
// (`received|sent|failed`): «Meta lo aceptó» y «el destinatario lo leyó» son
// hechos distintos y mezclarlos en un solo campo pierde uno de los dos. Null
// mientras el proveedor no haya dicho nada.
//
// Deuda declarada: `lib/messages/delivery-status.ts` —que aplica la monotonía
// de los callbacks— declara hoy su propia copia de esta unión con un TODO que
// apunta justo a este archivo. Son la misma unión y el mismo check de la 0017:
// hay que dejar una sola, y esta es la que debe quedar.
export const DELIVERY_STATUSES = [
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
] as const

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

// Ciclo de vida del binario del adjunto. Los cinco significan cosas distintas
// y la UI los distingue: `unavailable` es «Meta nunca lo ofreció» —el
// multimedia del historial de más de 14 días— y `failed` es «lo intentamos y
// no se pudo». Confundirlos haría reintentar para siempre una descarga que no
// existe.
export const ATTACHMENT_STATUSES = [
  "pending",
  "available",
  "failed",
  "deleted",
  "unavailable",
] as const

export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number]
