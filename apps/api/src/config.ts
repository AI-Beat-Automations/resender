export const API_DEFAULT_LIMIT = 25
export const API_MAX_LIMIT = 100
export const API_JSON_BODY_LIMIT_BYTES = 64 * 1024
export const PROVIDER_BODY_LIMIT_BYTES = 256 * 1024
// WhatsApp es la excepción, y el motivo es aritmético. Cloud API agrupa hasta
// 1000 updates en un solo POST, y el update más frecuente no es el mensaje sino
// el acuse: cada mensaje que enviamos genera tres (`sent`, `delivered`, `read`).
// Un status con sus objetos `conversation` y `pricing` mide ~354 B serializado,
// así que en 256 KB entran unos 740: un lote lleno de acuses **no cabe**, y un
// chunk de historial de Coexistence tampoco.
//
// Lo que pasa al no caber no es que se pierda un evento: `readRawLimited`
// contesta 413, Meta lo toma como entrega fallida y reintenta **el mismo cuerpo,
// que nunca va a caber**, hasta que se rinde. Se pierde el lote entero y en
// silencio. 1 MB deja sitio para los 1000 updates del peor caso con margen, y
// sigue siendo un techo muy por debajo de lo que aguanta el Worker.
//
// El límite de los demás proveedores no se toca: sus lotes son chicos y
// subírselo solo ampliaría la superficie de un cuerpo hostil sin ganar nada.
export const WHATSAPP_BODY_LIMIT_BYTES = 1024 * 1024
export const META_TIMEOUT_MS = 10_000
// Versión de Graph con la que hablan los dos clientes de Meta. Subirla no es un
// cambio de cadena: Meta agrega y quita campos entre versiones, así que hay que
// releer los parsers de webhook y lo que devuelve cada endpoint antes de tocarla.
// La constante gemela vive en `apps/web/lib/meta-graph.ts`, duplicada a
// propósito porque las dos apps no comparten runtime.
export const META_GRAPH_VERSION = "v23.0"
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 5_000
export const RECOVERY_BATCH_SIZE = 100
export const RECOVERY_HANDOFF_GRACE_SECONDS = 120
export const RECOVERY_PROCESSING_TIMEOUT_SECONDS = 120
export const RECOVERY_RETRY_GRACE_SECONDS = 120
export const QUEUE_RETRY_DELAYS_SECONDS = [5, 30, 120, 300, 900] as const
export const WEBHOOK_PAYLOAD_VERSION = 1
export const OPENAPI_VERSION = "1.0.0"
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200

export type RateLimitFamily =
  | "read"
  | "message_send"
  | "page_write"
  | "secret_rotation"

export function rateLimitFamily(
  method: string,
  pathname: string
): RateLimitFamily {
  if (method !== "POST") {
    return method === "PATCH" ? "page_write" : "read"
  }
  if (pathname === "/v1/messages") return "message_send"
  // Las respuestas a comentarios comparten cubeta con el envío de mensajes y no
  // con las escrituras de página: son la misma clase de operación —salir hacia
  // Meta por cada evento entrante— y el ritmo que hay que contener es el mismo.
  // Con cubetas separadas, un tenant que contesta comentarios podría duplicar su
  // presión sobre Graph sin tocar su límite de mensajes.
  if (/^\/v1\/comments\/[^/]+\/(replies|private-replies)$/u.test(pathname)) {
    return "message_send"
  }
  if (pathname.endsWith("/webhook-secret/rotate")) return "secret_rotation"
  return "page_write"
}
