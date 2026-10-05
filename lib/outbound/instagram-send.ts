import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
  extractMetaErrorSubcode,
  type MetaSendResult,
} from "./meta-send"
import type { OutboundAttachment } from "./send-request"

// Envío de mensajes directos por **Instagram API con Instagram Login**.
//
// Comparte el tipo de resultado con `meta-send.ts` —el sobre de error de Graph
// es el mismo y las rutas devuelven la misma forma al cliente— pero la request
// difiere en tres cosas que no son cosméticas:
//
// 1. **Host y path**: `graph.instagram.com/<v>/me/messages`. No hay id en el
//    path: el token ya identifica a la cuenta que envía.
// 2. **El token va en el header** `Authorization: Bearer`, no como query param.
// 3. **No lleva `messaging_type`**. Ese campo es de la Send API de Messenger;
//    Instagram no lo documenta y mandarlo es pedirle a Meta que lo rechace.
const GRAPH = "https://graph.instagram.com/v23.0"

// Instagram limita el texto a **1000 bytes UTF-8**, no a 1000 caracteres. La
// distinción importa en español: cada acento son 2 bytes y cada emoji 4, así
// que un texto de 800 caracteres puede pasarse del límite. Messenger, en
// cambio, cuenta 2000 caracteres.
export const INSTAGRAM_TEXT_MAX_BYTES = 1000

export function instagramTextByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8")
}

export function exceedsInstagramTextLimit(text: string): boolean {
  return instagramTextByteLength(text) > INSTAGRAM_TEXT_MAX_BYTES
}

export async function sendInstagramMessage(input: {
  accessToken: string
  recipientId: string
  message: { text: string } | { attachment: OutboundAttachment }
}): Promise<MetaSendResult> {
  const isAttachment = "attachment" in input.message
  try {
    // Mismo sobre que Messenger: `{ text }` o
    // `{ attachment: { type, payload: { url } } }`. Meta descarga el archivo
    // desde la URL; nosotros nunca subimos bytes.
    const message =
      "text" in input.message
        ? { text: input.message.text }
        : {
            attachment: {
              type: input.message.attachment.type,
              payload: { url: input.message.attachment.url },
            },
          }

    const response = await fetch(`${GRAPH}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        recipient: { id: input.recipientId },
        message,
      }),
    })

    const data = await response.json().catch(() => null)
    const metaError = extractMetaErrorMessage(data)
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok
        ? null
        : (metaError ?? `Meta returned HTTP ${response.status}`),
      reason: response.ok
        ? null
        : explainInstagramError(data, { attachment: isAttachment }),
      // Sin código estable de adjunto: Meta no documenta para Instagram los
      // subcodes de «no pude descargar la URL» o «formato rechazado», y
      // reusar los de Messenger sería adivinar.
      code: null,
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: error instanceof Error ? error.message : "Meta request failed",
      reason:
        "Could not reach Instagram's messaging API (network error or timeout). Retry shortly.",
      code: null,
    }
  }
}

// Catálogo propio en vez de reusar `explainMetaError`. Los códigos son los del
// sobre de Graph y varios coinciden, pero **lo que el usuario tiene que hacer
// es distinto**, y ese es el punto de traducir un error: en Messenger el 190
// significa que revocaron permisos, mientras que en Instagram el caso habitual
// es que el token simplemente venció a los ~60 días. Decir "reconectá la
// Página" a alguien que solo conectó Instagram lo manda a buscar algo que no
// tiene.
// Los tres motivos que **no** dependen de qué se estaba enviando: el token, el
// rate limit y el bloqueo por política valen igual para un DM, una respuesta
// pública y una respuesta privada. Se exportan para que los catálogos de
// `instagram-comment-reply.ts` los reusen en vez de recopiarlos: ahí lo que
// cambia es el diagnóstico, no estos tres.
export const INSTAGRAM_TOKEN_EXPIRED_REASON =
  "The Instagram access token expired or was revoked. Instagram tokens last about 60 days: reconnect the account in Resender."
export const INSTAGRAM_RATE_LIMIT_REASON =
  "Meta rate limit reached for this app or account. Retry later."
export const INSTAGRAM_BLOCKED_REASON =
  "The account is temporarily blocked from taking this action due to a policy violation on Meta's side."

export function explainInstagramError(
  data: unknown,
  context: { attachment: boolean } = { attachment: false }
): string | null {
  const code = extractMetaErrorCode(data)
  if (code === null) return null
  const subcode = extractMetaErrorSubcode(data)

  if (code === 190) {
    return INSTAGRAM_TOKEN_EXPIRED_REASON
  }

  // La ventana de 24 h. El subcode es distinto del de Messenger (2018278), así
  // que compartir el catálogo habría hecho que este caso —el más frecuente de
  // todos en Instagram— cayera en la rama genérica de permisos y mandara al
  // usuario a revisar algo que está bien.
  if (code === 10 && subcode === 2534022) {
    return "Instagram's 24-hour window is closed: this contact hasn't messaged the account in the last 24 hours, so Meta rejects new messages until they write again."
  }
  if (code === 10) {
    return "Meta permission error: the app is missing the instagram_business_manage_messages permission for this send, or the account isn't allowed to message this user."
  }

  if (code === 551) {
    return "This person isn't available: they may have blocked the account, deleted the conversation, or deactivated it."
  }
  // Con un adjunto, el `100` también es el rechazo típico de una URL que Meta
  // no pudo descargar o de un formato/tamaño fuera de lo que acepta Instagram.
  // Sin subcode documentado no se puede separar del IGSID equivocado, así que
  // el motivo nombra las dos cosas en vez de mandar a revisar solo una.
  if (code === 100 && context.attachment) {
    return "Instagram rejected the request: check that the recipient ID is an IGSID from a conversation with this account, and that the attachment URL is publicly reachable over https with a format and size Instagram accepts for this attachment.type (image: png/jpeg up to 8 MB; audio, video and file: up to 25 MB; file must be a PDF)."
  }
  if (code === 100) {
    return "Instagram rejected the request: check that the recipient ID is an IGSID from a conversation with this account."
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return INSTAGRAM_RATE_LIMIT_REASON
  }
  if (code === 368) {
    return INSTAGRAM_BLOCKED_REASON
  }
  return null
}

// Instagram devuelve `message_id` igual que Messenger, así que la extracción es
// la misma; se reexporta desde acá para que la ruta de Instagram no tenga que
// importar del módulo de Messenger para leer su propia respuesta.
export { extractMetaMessageId, isMetaExpiredTokenError } from "./meta-send"
