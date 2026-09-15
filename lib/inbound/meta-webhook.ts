import type {
  AttachmentBookingDetails,
  AttachmentProductElement,
  InboundAttachment,
  InboundEvent,
} from "./inbound-event"

// Parser del webhook de **Messenger**. El de Instagram vive en
// `instagram-webhook.ts`: los dos payloads se llaman `entry[].messaging[]` pero
// no traen los mismos campos ni las mismas trampas.
//
// El shape de `attachments` es deliberadamente laxo (`payload` como record
// abierto): cada tipo de adjunto trae claves distintas y la normalización las
// valida una por una en `normalizeAttachments`, no acá.
type RawAttachment = {
  type?: unknown
  payload?: Record<string, unknown> | null
}

type MetaWebhookBody = {
  entry?: Array<{
    id?: unknown
    messaging?: Array<{
      sender?: { id?: unknown }
      timestamp?: unknown
      message?: {
        mid?: unknown
        text?: unknown
        attachments?: RawAttachment[]
      }
      postback?: {
        mid?: unknown
        title?: unknown
        payload?: unknown
      }
    }>
  }>
}

export function extractInboundEvents(body: unknown): InboundEvent[] {
  if (!body || typeof body !== "object") return []

  const entries = (body as MetaWebhookBody).entry ?? []
  const events: InboundEvent[] = []

  for (const entry of entries) {
    if (typeof entry.id !== "string") continue

    for (const event of entry.messaging ?? []) {
      const senderId =
        typeof event.sender?.id === "string" ? event.sender.id : "unknown"
      const timestamp = normalizeTimestamp(event.timestamp)
      const rawText = event.message?.text
      const text =
        typeof rawText === "string" && rawText.trim().length > 0
          ? rawText.trim()
          : ""
      const attachment = normalizeAttachments(
        Array.isArray(event.message?.attachments)
          ? event.message.attachments
          : []
      )

      // Un mensaje existe si trajo texto **o** adjunto: un solo-adjunto (una
      // foto, un audio, un share) ya no se descarta en silencio. Sin ninguno de
      // los dos —y sin postback abajo— se sigue tirando: no hay nada que
      // persistir ni que reenviar.
      if (text.length > 0 || attachment) {
        events.push({
          eventType: "message",
          metaPageId: entry.id,
          senderId,
          text,
          attachment,
          metaMessageId:
            typeof event.message?.mid === "string" ? event.message.mid : null,
          postbackPayload: null,
          timestamp,
        })
        continue
      }

      const postback = event.postback
      if (!postback) continue

      const payload = postback.payload
      if (typeof payload !== "string" || payload.trim().length === 0) continue

      const postbackPayload = payload.trim()
      const title =
        typeof postback.title === "string" ? postback.title.trim() : ""

      events.push({
        eventType: "postback",
        metaPageId: entry.id,
        senderId,
        text: formatPostbackText(postbackPayload, title),
        attachment: null,
        metaMessageId:
          typeof postback.mid === "string"
            ? postback.mid
            : buildSyntheticPostbackId({
                metaPageId: entry.id,
                senderId,
                timestamp: event.timestamp,
                payload: postbackPayload,
              }),
        postbackPayload,
        timestamp,
      })
    }
  }

  return events
}

// Reduce la lista cruda de adjuntos de Meta a **uno** normalizado, que es lo
// que persiste la columna `attachment_type` de `messages` (migración 0016).
// Dos pasos con semánticas distintas:
//
// 1. El gemelo del sticker: hasta el 30 ago 2026 Meta manda cada sticker
//    duplicado como `image` + `sticker` con la misma URL. Quitar esas imágenes
//    es normalizar un duplicado, no perder nada, y por eso NO suma a
//    `droppedCount`.
// 2. Del resto queda el primero. Si había más —adjuntos distintos que el
//    contacto mandó de verdad—, el que queda lleva `details.droppedCount` con
//    la cantidad descartada; cuando no se descartó nada la clave no existe.
function normalizeAttachments(raw: RawAttachment[]): InboundAttachment | null {
  const mapped = raw.map(mapAttachment)

  const sticker = mapped.find((item) => item.type === "sticker")
  const deduped =
    sticker && sticker.url !== null
      ? mapped.filter(
          (item) => !(item.type === "image" && item.url === sticker.url)
        )
      : mapped

  const [first, ...rest] = deduped
  if (!first) return null
  if (rest.length > 0) first.details.droppedCount = rest.length
  return first
}

// Mapea un elemento crudo al shape fijo de su tipo. Cualquier `type` que no
// esté en el catálogo sale como `unknown` con el nombre real en
// `details.rawType` y el elemento entero en `details.raw`: sin eso, un tipo
// nuevo de Meta perdería su nombre y no se podría ni contar en producción.
function mapAttachment(element: RawAttachment): InboundAttachment {
  const type = typeof element.type === "string" ? element.type : ""
  const payload =
    element.payload && typeof element.payload === "object"
      ? element.payload
      : {}
  const url = typeof payload.url === "string" ? payload.url : null
  const title = typeof payload.title === "string" ? payload.title : null

  switch (type) {
    case "image":
    case "audio":
    case "video":
    case "file":
      return { type, url, title: null, details: {} }
    case "sticker":
      return {
        type,
        url,
        title: null,
        details:
          payload.sticker_id != null
            ? { stickerId: String(payload.sticker_id) }
            : {},
      }
    case "reel":
    case "ig_reel":
      return {
        type,
        url,
        title,
        details:
          payload.reel_video_id != null
            ? { reelVideoId: String(payload.reel_video_id) }
            : {},
      }
    case "post":
    case "ig_post":
      return {
        type,
        url,
        title,
        details: payload.id != null ? { postId: String(payload.id) } : {},
      }
    case "fallback":
      // Un share genérico: puede venir con URL y título, o sin payload alguno.
      return { type, url, title, details: {} }
    case "appointment_booking": {
      const booking = mapBooking(payload)
      // Sin `booking_id` no hay reserva que nombrar: cae al `unknown` de abajo
      // con el payload entero, en vez de persistir un booking vacío.
      if (booking) {
        return { type, url: null, title: null, details: { booking } }
      }
      break
    }
    case "template":
      return {
        type,
        url: null,
        title: null,
        details: { elements: mapProductElements(payload) },
      }
  }

  return {
    type: "unknown",
    url,
    title,
    details: { rawType: type, raw: element },
  }
}

function mapBooking(
  payload: Record<string, unknown>
): AttachmentBookingDetails | null {
  if (payload.booking_id == null) return null
  return {
    bookingId: String(payload.booking_id),
    status: typeof payload.status === "string" ? payload.status : null,
    startTime:
      typeof payload.start_time === "number" ? payload.start_time : null,
    endTime: typeof payload.end_time === "number" ? payload.end_time : null,
    timezone: typeof payload.timezone === "string" ? payload.timezone : null,
  }
}

function mapProductElements(
  payload: Record<string, unknown>
): AttachmentProductElement[] {
  const product = payload.product
  const rawElements =
    product &&
    typeof product === "object" &&
    Array.isArray((product as { elements?: unknown }).elements)
      ? (product as { elements: unknown[] }).elements
      : []

  return rawElements
    .filter(
      (element): element is Record<string, unknown> =>
        !!element && typeof element === "object"
    )
    .map((element) => ({
      // Los ids se pasan por String(): Meta los manda a veces como número.
      id: element.id != null ? String(element.id) : null,
      retailerId:
        element.retailer_id != null ? String(element.retailer_id) : null,
      imageUrl:
        typeof element.image_url === "string" ? element.image_url : null,
      title: typeof element.title === "string" ? element.title : null,
      subtitle: typeof element.subtitle === "string" ? element.subtitle : null,
    }))
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number") return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function formatPostbackText(payload: string, title: string) {
  if (payload === "GET_STARTED") return "GET_STARTED"
  return title ? `${title} (${payload})` : `POSTBACK:${payload}`
}

function buildSyntheticPostbackId(input: {
  metaPageId: string
  senderId: string
  timestamp: unknown
  payload: string
}) {
  const timestamp =
    typeof input.timestamp === "number" ? String(input.timestamp) : "unknown"
  const encodedPayload = Buffer.from(input.payload).toString("base64url")
  return `postback:${input.metaPageId}:${input.senderId}:${timestamp}:${encodedPayload}`
}
