import {
  deleteConversationIfEmpty,
  getConversationByContact,
  updateConversationContactId,
  type ConversationRecord,
} from "@/lib/messages/message-log"

// El destinatario de WhatsApp y la conversación a la que tiene que ir a parar
// (ADR 0024, decisión 12).
//
// El entrante de Cloud API trae `from` = `wa_id`: solo dígitos, sin `+`. Si un
// envío guarda el número tal como lo tecleó el cliente de la API
// (`+52 55 1234-5678`), la conversación que crea no es la misma a la que
// después llega la respuesta, y el Inbox muestra dos hilos con la misma
// persona. Hasta las plantillas no se notaba porque siempre escribía primero el
// contacto; con plantillas escribir primero es el caso normal.

// E.164 permite hasta 15 dígitos; menos de 8 no es un número internacional
// completo en ningún plan de numeración.
const MIN_DIGITS = 8
const MAX_DIGITS = 15

export const INVALID_WHATSAPP_RECIPIENT_ERROR = `recipientId must be a phone number in international format (country code included): ${MIN_DIGITS} to ${MAX_DIGITS} digits, with or without "+", spaces or dashes`

// Deja solo los dígitos y **sin `+`**, igual que el `wa_id`. Es la hermana de
// `normalizeWhatsappPhoneE164` (que agrega el `+` porque guarda el número de la
// cuenta conectada), no una reutilización: el `contact_id` tiene que ser
// comparable byte a byte con el `from` de los entrantes.
//
// Solo se aplica en WhatsApp: en Messenger e Instagram `recipientId` es un PSID
// o un IGSID y no se toca.
export function normalizeWhatsappRecipientId(value: string): string | null {
  const digits = value.replace(/\D/g, "")
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null
  return digits
}

export type WhatsappContactReconciliation =
  | { kind: "unchanged"; conversation: ConversationRecord }
  // No había conversación con el `wa_id`: la usada pasa a llevarlo.
  | { kind: "renamed"; conversation: ConversationRecord }
  // Ya había una: el mensaje va a esa, y la usada se borró si quedó vacía.
  | {
      kind: "merged"
      conversation: ConversationRecord
      discardedConversationId: string | null
    }

// Concilia la conversación usada para enviar con el `contacts[0].wa_id` que
// devolvió Cloud API. En MX y AR el `wa_id` puede no coincidir con el número
// marcado (`52…` contra `521…`), y la respuesta del contacto va a llegar con el
// `wa_id`: el saliente tiene que quedar en esa misma conversación.
//
// Se llama **antes** de persistir el mensaje, así que la conversación que
// devuelve es la que va en el insert y en `resender.conversationId`. La
// comparten `/whatsapp/send` y el envío de plantillas.
export async function reconcileWhatsappContact(input: {
  tenantId: string
  conversation: ConversationRecord
  waId: string | null
}): Promise<WhatsappContactReconciliation> {
  const { tenantId, conversation, waId } = input
  if (!waId || waId === conversation.contactId) {
    return { kind: "unchanged", conversation }
  }

  const existing = await getConversationByContact({
    tenantId,
    connectedPageId: conversation.connectedPageId,
    contactId: waId,
  })

  if (!existing) {
    const renamed = await updateConversationContactId({
      tenantId,
      conversationId: conversation.id,
      contactId: waId,
    })
    if (renamed) return { kind: "renamed", conversation: renamed }
  }

  // Ya existía, o apareció entre la lectura y el update (un entrante del mismo
  // contacto): se relee para no perder la carrera.
  const target =
    existing ??
    (await getConversationByContact({
      tenantId,
      connectedPageId: conversation.connectedPageId,
      contactId: waId,
    }))
  if (!target) return { kind: "unchanged", conversation }

  // Solo si quedó sin mensajes: una conversación con historial bajo el número
  // marcado no se borra, aunque de acá en adelante se escriba en la otra.
  const discarded = await deleteConversationIfEmpty({
    tenantId,
    conversationId: conversation.id,
  })

  return {
    kind: "merged",
    conversation: target,
    discardedConversationId: discarded ? conversation.id : null,
  }
}
