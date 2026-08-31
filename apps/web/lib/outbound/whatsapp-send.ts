import {
  buildWhatsappMessagePayload,
  sendWhatsappMessage,
  type WhatsappOutboundMediaType,
  type WhatsappOutboundMessage,
  type WhatsappOutboundTemplate,
} from "@/lib/meta/whatsapp-client"

import type { MetaSendResult } from "./meta-send"
import type { OutboundAttachment, OutboundAttachmentType } from "./send-request"

// El adaptador entre el body neutral de la API pública —el mismo de Messenger,
// `{ reply } | { attachment: { type, url } }`— y el sobre de Cloud API.
//
// Vive acá y no en `lib/meta/whatsapp-client.ts` a propósito: ese archivo habla
// el idioma de Meta y no tiene por qué conocer el contrato público de Resender.
// Este es el único lugar donde los dos vocabularios se tocan, y es el que hay
// que abrir cuando alguno de los dos cambia.
//
// **Resender nunca hospeda media saliente.** El cliente manda una URL https
// pública y Meta descarga el archivo desde ahí, exactamente igual que en
// Messenger. Es una decisión, no una omisión, y tiene dos consecuencias que hay
// que decirle al cliente en la doc en vez de esconderlas:
//
//  1. Meta cachea el archivo apenas ~10 minutos. La URL no puede ser de un solo
//     uso ni caducar en segundos: si Meta reintenta la descarga fuera de esa
//     ventana, vuelve a pegarle al origen.
//  2. Si el origen del cliente está caído en el instante del envío, el mensaje
//     falla. No hay copia nuestra que sirva de respaldo, y el error que se ve es
//     el 131053 de Meta ("no pude bajar la media"), que este canal traduce a
//     `attachment_fetch_failed`.

// El único renombre entre los dos vocabularios. El catálogo público llama
// `file` a lo que Cloud API llama `document`; los otros tres coinciden. Es un
// `Record` completo y no un `switch` con default para que agregar un tipo a
// `OUTBOUND_ATTACHMENT_TYPES` rompa la compilación acá en vez de mandarle a
// Meta un `type` que no existe.
export const WHATSAPP_MEDIA_TYPE_BY_ATTACHMENT: Record<
  OutboundAttachmentType,
  WhatsappOutboundMediaType
> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "document",
}

// Exactamente una de las tres cosas. Las dos primeras las garantiza
// `parseOutboundSendInput`; la tercera viene del parser propio de la ruta de
// plantillas, porque el parser neutral no la conoce y no va a conocerla: es
// compartido con Messenger e Instagram y meterle un XOR de tres ramas que dos
// canales no pueden usar era costo permanente para los tres (ADR 0014).
//
// La unión discriminada se repite acá —en vez de aceptar opcionales sueltos—
// para que la función sea total y no haga falta un `throw` para el caso
// imposible. `template` queda opcional en los dos miembros viejos por una razón
// concreta y no por comodidad: la ruta de envío libre construye su contenido con
// dos claves y no tiene por qué aprender una tercera que nunca va a usar.
export type WhatsappOutboundContent =
  | { reply: string; attachment: null; template?: null }
  | { reply: null; attachment: OutboundAttachment; template?: null }
  | { reply: null; attachment: null; template: WhatsappOutboundTemplate }

/**
 * Traduce el contenido de la request al mensaje de Cloud API.
 *
 * El texto va sin `previewUrl`: la API pública no expone hoy esa opción y el
 * default de Meta —renderizar la tarjeta del primer enlace— cambiaría cómo se
 * ve el mensaje que el tenant escribió sin que él lo haya pedido.
 *
 * El adjunto va siempre por `link` y nunca por `id`: subir el archivo primero a
 * la Media API sería hospedar media saliente, que es justo lo que este canal no
 * hace. Sin `caption` ni `filename` porque el body público no los trae todavía.
 *
 * La plantilla es la única de las tres que no se traduce: el contrato público
 * —`{ name, language, components }`— y el de Meta coinciden campo por campo,
 * porque nombre e idioma es lo único que Cloud API acepta al enviar y exponer
 * otra cosa habría puesto una traducción obligatoria contra una copia local que
 * la ADR 0014 declara no autoritativa. La diferencia de forma —`language` como
 * objeto con `code`— la pone el payload builder, que es donde vive el sobre.
 * Los `components` pasan derecho y sin mirar: no se valida el conteo de
 * parámetros, por lo mismo.
 */
export function toWhatsappOutboundMessage(
  content: WhatsappOutboundContent
): WhatsappOutboundMessage {
  if (content.template) {
    return { template: content.template }
  }

  if (content.attachment) {
    return {
      media: {
        type: WHATSAPP_MEDIA_TYPE_BY_ATTACHMENT[content.attachment.type],
        link: content.attachment.url,
      },
    }
  }

  return { text: content.reply }
}

/**
 * El payload literal que sale hacia Cloud API. No lo usa el envío —
 * `sendWhatsappMessage` lo arma por su cuenta— y existe para que los tests y el
 * log puedan mirar la forma exacta del sobre sin salir a la red.
 */
export function buildWhatsappOutboundPayload(
  to: string,
  content: WhatsappOutboundContent
): Record<string, unknown> {
  return buildWhatsappMessagePayload(to, toWhatsappOutboundMessage(content))
}

/**
 * Envía el contenido de la request por Cloud API.
 *
 * Es una capa fina sobre `sendWhatsappMessage` y no un envío propio: el
 * `MetaSendResult` que devuelve ya trae `reason` y `code` traducidos por
 * `explainWhatsappError`, que es el catálogo del canal. Duplicar acá la
 * traducción sería tener dos catálogos de WhatsApp que se desincronizan.
 *
 * `phoneNumberId` es el `connected_pages.meta_page_id` de la fila del canal
 * `whatsapp`: en WhatsApp esa columna guarda el `phone_number_id` y no una
 * Página, así que el `pageId` público y el id del path son el mismo valor.
 */
export async function sendWhatsappOutboundMessage(input: {
  accessToken: string
  phoneNumberId: string
  to: string
  content: WhatsappOutboundContent
}): Promise<MetaSendResult> {
  return sendWhatsappMessage({
    accessToken: input.accessToken,
    phoneNumberId: input.phoneNumberId,
    to: input.to,
    message: toWhatsappOutboundMessage(input.content),
  })
}

// Cloud API contesta `{"messages":[{"id":"wamid…"}]}` y no el `message_id` de
// Messenger, así que la extracción es la del cliente de WhatsApp y no la de
// `meta-send.ts`. Se reexporta desde acá —igual que hace `instagram-send.ts`
// con la suya— para que la ruta lea su propia respuesta importando un solo
// módulo y no pueda equivocarse de extractor: el de Messenger devolvería `null`
// siempre y el wamid se perdería, dejando la fila sin el id con el que después
// llegan sus `statuses`.
export {
  exceedsWhatsappTextLimit,
  explainWhatsappError,
  extractWhatsappMessageId,
  isWhatsappExpiredTokenError,
  WHATSAPP_TEXT_MAX_CHARS,
} from "@/lib/meta/whatsapp-client"

// La forma de la plantilla al enviar, por el mismo motivo de la línea de
// arriba: la ruta de plantillas arma su `WhatsappOutboundContent` acá y no
// tiene por qué importar además el cliente de Meta para nombrar el tipo de un
// campo que este módulo ya expone.
export type { WhatsappOutboundTemplate } from "@/lib/meta/whatsapp-client"
