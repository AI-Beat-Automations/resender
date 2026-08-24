import type {
  AttachmentStatus,
  MessageAttachmentType,
} from "@/lib/messages/message-enums"

// Semántica visual de un adjunto en la bitácora (CONTEXT.md, «Semantica
// visual de Inbox»): preview de imagen, video o audio cuando hay URL usable,
// y una fila compacta con tipo + identificador para todo lo demás. La regla
// vive fuera del .tsx a propósito: los componentes no corren bajo Vitest y
// esta función sí tiene que estar cubierta.

export type AttachmentDisplay =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "audio"; url: string }
  | { kind: "row"; label: string; url: string | null }

type PreviewKind = "image" | "video" | "audio" | "row"

/**
 * Qué se puede pintar de cada `attachment_type`, **el catálogo entero**.
 *
 * Es un `Record<MessageAttachmentType, …>` y no un mapa parcial con caída
 * implícita: así el tipo número diecinueve no compila hasta que alguien decida
 * si tiene preview o no. Antes, un type que faltaba caía en «fila» sin que nada
 * lo dijera, y eso mismo fue lo que hizo que los seis de la 0017 aparecieran
 * como filas mudas.
 *
 * `file` queda en fila a propósito: es un documento descargable y el navegador
 * no lo previsualiza. Los seis que suma WhatsApp también: `location`,
 * `contacts`, `order`, `system` e `interactive` no son binarios —son cargas
 * estructuradas— y `reaction` ni siquiera llega hasta acá, porque no se dibuja
 * como burbuja propia sino sobre el mensaje al que apunta
 * (`groupThreadReactions`, en `lib/messages/display.ts`).
 */
const PREVIEW_KIND: Record<MessageAttachmentType, PreviewKind> = {
  image: "image",
  sticker: "image",
  video: "video",
  reel: "video",
  ig_reel: "video",
  audio: "audio",
  file: "row",
  post: "row",
  ig_post: "row",
  fallback: "row",
  appointment_booking: "row",
  template: "row",
  unknown: "row",
  location: "row",
  contacts: "row",
  reaction: "row",
  interactive: "row",
  order: "row",
  system: "row",
}

/**
 * Lo que la burbuja dice en cada estado del binario (`attachment_status`, 0017).
 *
 * Los cinco textos son distintos porque los cinco estados son distintos, y esto
 * es requisito de producto, no un detalle: colapsar `failed` con `unavailable`
 * en un «no se pudo mostrar» genérico deja a soporte sin poder distinguir un bug
 * nuestro —lo intentamos y falló— de un límite de Meta —nunca hubo archivo que
 * pedir, porque el historial de más de 14 días no trae multimedia—.
 *
 * Va en el módulo puro y no en el `.tsx` por la misma razón que el resto: acá se
 * puede testear que ninguno de los cinco se quedó sin copy.
 */
export const ATTACHMENT_STATUS_COPY: Record<AttachmentStatus, string> = {
  pending: "descargando…",
  available: "preview / descarga",
  failed: "no se pudo descargar",
  deleted: "archivo expirado",
  unavailable: "WhatsApp no conserva archivos de más de 14 días",
}

/**
 * La ruta propia que sirve la media de WhatsApp.
 *
 * **No** es una URL del CDN de Meta, a diferencia de Messenger e Instagram: la
 * URL que devuelve Cloud API dura cinco minutos y exige el token de la cuenta,
 * así que un `<img src>` apuntando ahí se rompe siempre. La única copia que
 * dura es la de R2, y esta ruta es la que la sirve autorizando por tenant.
 */
export const WHATSAPP_MEDIA_ROUTE = "/api/meta/whatsapp/media"

/**
 * De dónde baja el binario de este mensaje, o `null` si no hay de dónde.
 *
 * `unavailable` y `deleted` devuelven `null` y no la ruta: en los dos casos el
 * objeto **no existe** —nunca existió, o venció a los 180 días—, y darle un link
 * al usuario solo sirve para que se coma un 404. Los otros tres sí la devuelven:
 * `available` porque está, y `pending`/`failed` porque la ruta es la que sabe
 * decir qué pasó (el que decide si se pinta o no es `toAttachmentDisplay`, que
 * en esos dos estados dibuja la fila con el copy en vez del preview).
 */
export function whatsappMediaUrl(input: {
  messageId: string
  status: AttachmentStatus
}): string | null {
  if (input.status === "unavailable" || input.status === "deleted") return null
  return `${WHATSAPP_MEDIA_ROUTE}/${input.messageId}`
}

/**
 * Decide qué se pinta para el adjunto de un mensaje. Solo mapea el adjunto:
 * si el mensaje además trae texto, eso lo resuelve la vista, no esta función.
 *
 * En Messenger e Instagram, Resender NO proxifica ni valida la URL (nada de
 * fetch/HEAD): si la firma del CDN de Meta venció, la burbuja se rompe — es el
 * costo asumido de no hospedar los archivos. En WhatsApp no hay CDN que valga y
 * `status` es lo que manda: es el estado ya derivado por `effectiveStatus`, y
 * cualquier valor que no sea `available` significa que no hay binario que
 * mostrar, así que la burbuja dice por qué en vez de intentar el preview.
 */
export function toAttachmentDisplay(
  input: {
    type: string
    url: string | null
    meta: Record<string, unknown> | null
    /**
     * Solo WhatsApp lo informa (`attachment_status`, 0017), y ya derivado por
     * `effectiveStatus`. `null`/ausente es «este canal no hospeda nada»:
     * Messenger e Instagram siguen exactamente como antes.
     */
    status?: AttachmentStatus | null
  } | null
): AttachmentDisplay | null {
  if (!input) return null

  // El estado gana sobre la URL: un adjunto vencido con la ruta todavía
  // formada no se pinta como preview roto, se explica.
  if (input.status && input.status !== "available") {
    return {
      kind: "row",
      label: `${input.type} · ${ATTACHMENT_STATUS_COPY[input.status]}`,
      url: null,
    }
  }

  // «Usable» acá es solo forma: `https` no vacía, o una ruta propia. Sirve
  // tanto para el preview como para el link de la fila — un esquema raro no
  // merece ni el <a>.
  const url = usableUrl(input.url)

  const previewKind = url ? previewKindOf(input.type) : "row"
  if (previewKind !== "row" && url) {
    return { kind: previewKind, url }
  }

  return { kind: "row", label: rowLabel(input.type, input.meta), url }
}

// Un `attachment_type` fuera del catálogo no debería existir —lo veta el check
// de la 0017—, pero si llega, fila: es la caída que no rompe la pantalla.
function previewKindOf(type: string): PreviewKind {
  return PREVIEW_KIND[type as MessageAttachmentType] ?? "row"
}

/** `post · Mirá esta oferta`, `sticker · 369239263222822`, o el type a secas. */
function rowLabel(type: string, meta: Record<string, unknown> | null) {
  const identifier = bestIdentifier(meta)
  return identifier ? `${type} · ${identifier}` : type
}

// El mejor identificador disponible, en orden de utilidad para quien lee la
// bitácora: el título humano primero, después los ids que se citan en soporte.
//
// Los tres últimos son de WhatsApp: una ubicación se lee por su nombre o su
// dirección, y un pedido por su id de catálogo. Sin ellos, la fila de un
// `location` decía «location» a secas y no había forma de saber cuál.
function bestIdentifier(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  return (
    asText(meta.title) ??
    asText(meta.name) ??
    asText(meta.address) ??
    asText(meta.stickerId) ??
    asText(meta.postId) ??
    asText(meta.catalogId) ??
    bookingId(meta.booking) ??
    asText(meta.rawType)
  )
}

function bookingId(booking: unknown): string | null {
  if (typeof booking !== "object" || booking === null) return null
  return asText((booking as Record<string, unknown>).bookingId)
}

// Meta manda ids como string o número según el campo; los dos sirven de label.
function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

// `https://` para el CDN de Meta y `/` para la ruta propia de WhatsApp. La
// segunda no es una concesión: es la única forma que tiene la media de este
// canal, y exigirle `https://` la dejaría siempre fuera del preview.
function usableUrl(url: string | null): string | null {
  if (!url) return null
  return url.startsWith("https://") || url.startsWith("/") ? url : null
}
