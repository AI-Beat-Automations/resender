import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
  extractMetaErrorSubcode,
  type MetaSendResult,
} from "./meta-send"
import {
  INSTAGRAM_BLOCKED_REASON,
  INSTAGRAM_RATE_LIMIT_REASON,
  INSTAGRAM_TOKEN_EXPIRED_REASON,
} from "./instagram-send"

// Las **dos** formas de contestarle a quien comentó, que Meta trata como cosas
// distintas y que el producto expone como dos endpoints:
//
// | | Respuesta pública | Respuesta privada |
// |---|---|---|
// | Endpoint | `POST /<ig-comment-id>/replies` | `POST /me/messages` |
// | Dónde aparece | debajo de la publicación | en la bandeja de DMs |
// | Ventana | sin ventana | **7 días** desde el comentario |
// | Cuántas | las que se quieran | **una sola** por comentario |
// | Se persiste en | `instagram_comments` | `messages`, con `instagram_source_comment_id` |
//
// Comparten host, versión y permiso (`instagram_business_manage_comments`) pero
// nada más, y sobre todo no comparten catálogo de errores: lo que el usuario
// tiene que hacer cuando una falla no se parece a lo que tiene que hacer cuando
// falla la otra.
const GRAPH = "https://graph.instagram.com/v23.0"

// Un comentario de Instagram admite 2200 caracteres, el mismo techo que un pie
// de foto. **Se cuenta en caracteres y no en bytes**, al revés que el DM
// (`INSTAGRAM_TEXT_MAX_BYTES`): son dos superficies distintas de Instagram con
// dos límites distintos, y usar el de una para la otra rechazaría texto válido
// o dejaría pasar texto que Meta va a rechazar.
//
// El límite no está en la referencia de Graph —la referencia no documenta
// ninguno— pero es el de la plataforma y el que aplica el propio Instagram.
export const INSTAGRAM_COMMENT_MAX_CHARS = 2200

export function exceedsInstagramCommentLimit(text: string): boolean {
  return [...text].length > INSTAGRAM_COMMENT_MAX_CHARS
}

// Se cuenta por code points y no por `text.length`, que cuenta unidades UTF-16:
// un emoji fuera del plano básico son dos unidades y un solo carácter, así que
// `length` rechazaría un comentario de 1200 emojis que Instagram acepta.
export function instagramCommentLength(text: string): number {
  return [...text].length
}

// Respuesta **pública**: se publica como un comentario anidado bajo el que se
// está contestando.
//
// Dos detalles del endpoint que no son cosméticos:
//
// 1. El id del comentario va **en el path**, a diferencia del DM, que sale del
//    token. Acá el token dice quién responde y el path a qué.
// 2. El `message` va como cuerpo `x-www-form-urlencoded` y no en la query
//    string, que es como lo muestra la documentación. Es la forma que Graph
//    acepta desde siempre y mantiene el texto del usuario fuera de la URL, o
//    sea fuera de cualquier log de requests.
export async function replyToInstagramComment(input: {
  accessToken: string
  igCommentId: string
  text: string
}): Promise<MetaSendResult> {
  return callGraph({
    url: `${GRAPH}/${encodeURIComponent(input.igCommentId)}/replies`,
    accessToken: input.accessToken,
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ message: input.text }).toString(),
    explain: explainInstagramCommentError,
    networkReason:
      "Could not reach Instagram's comment API (network error or timeout). Retry shortly.",
  })
}

// Respuesta **privada**: es un DM, pero no se manda al IGSID sino al comentario.
// `recipient.comment_id` es lo que le dice a Meta que este envío se ampara en el
// comentario y no en la ventana de 24 horas de la mensajería normal — es la
// única manera de escribirle primero a alguien que nunca mandó un DM.
//
// Va a `/me/messages`, el mismo endpoint que un DM normal: lo que cambia es el
// `recipient`. La documentación lo escribe como `/<IG_ID>/messages`, que con
// Instagram Login resuelve a la misma cuenta que `me`; se usa `me` porque el
// token ya la identifica y así un `pageId` que no corresponda al token no puede
// convertirse en un error de Meta difícil de leer.
export async function sendInstagramPrivateReply(input: {
  accessToken: string
  igCommentId: string
  text: string
}): Promise<MetaSendResult> {
  return callGraph({
    url: `${GRAPH}/me/messages`,
    accessToken: input.accessToken,
    contentType: "application/json",
    body: JSON.stringify({
      recipient: { comment_id: input.igCommentId },
      message: { text: input.text },
    }),
    explain: explainInstagramPrivateReplyError,
    networkReason:
      "Could not reach Instagram's messaging API (network error or timeout). Retry shortly.",
  })
}

async function callGraph(input: {
  url: string
  accessToken: string
  contentType: string
  body: string
  explain: (data: unknown) => string | null
  networkReason: string
}): Promise<MetaSendResult> {
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        // Igual que en el DM: el token va en el header y no como query param,
        // así no aparece en ningún log de URLs.
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": input.contentType,
      },
      signal: AbortSignal.timeout(10000),
      body: input.body,
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
      reason: response.ok ? null : input.explain(data),
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: error instanceof Error ? error.message : "Meta request failed",
      reason: input.networkReason,
    }
  }
}

// Catálogo de la respuesta **pública**. Separado del de los DMs porque el
// diagnóstico de los códigos que comparten es otro: acá un 10 nunca es la
// ventana de 24 horas —una respuesta pública no tiene ventana— sino el permiso
// de comentarios, y un 100 es un comentario que ya no se puede contestar y no
// un IGSID mal formado.
export function explainInstagramCommentError(data: unknown): string | null {
  const code = extractMetaErrorCode(data)
  if (code === null) return null

  if (code === 190) return INSTAGRAM_TOKEN_EXPIRED_REASON
  if (code === 10) {
    return "Meta permission error: the app is missing the instagram_business_manage_comments permission for this account."
  }
  if (code === 100) {
    return "Instagram rejected the comment id: the comment may have been deleted or hidden, or it may belong to a live video, which can't be replied to."
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return INSTAGRAM_RATE_LIMIT_REASON
  }
  if (code === 368) return INSTAGRAM_BLOCKED_REASON
  return null
}

// Catálogo de la respuesta **privada**. Es el que más se aleja de los otros dos
// porque sus dos fallas típicas no existen en ningún otro envío: el comentario
// dejó de ser elegible (pasaron 7 días, lo borraron, ya le contestamos) y la
// cuenta tiene los DMs deshabilitados.
export function explainInstagramPrivateReplyError(
  data: unknown
): string | null {
  const code = extractMetaErrorCode(data)
  if (code === null) return null
  const subcode = extractMetaErrorSubcode(data)

  if (code === 190) return INSTAGRAM_TOKEN_EXPIRED_REASON

  // El rechazo más frecuente de este endpoint, y el que junta cuatro causas
  // distintas bajo un mismo código: Meta no dice cuál de las cuatro fue, así
  // que el mensaje las enumera en vez de adivinar una.
  if (code === 100 && subcode === 2534025) {
    return "This comment can't receive a private reply: private replies are only allowed within 7 days of the comment, only one per comment, and the comment must still exist and come from someone whose settings accept message requests."
  }
  // Meta ya mandó una respuesta privada a este comentario. Resender también lo
  // chequea antes de llamar, así que llegar hasta acá significa que la primera
  // respuesta salió por fuera de Resender.
  if (code === 10900) {
    return "This comment already received a private reply. Instagram allows exactly one per comment."
  }
  if (code === 200 && subcode === 2534041) {
    return "The Instagram account owner disabled access to direct messages in the app's settings, so no private reply can be sent."
  }
  if (code === 10) {
    return "Meta permission error: the app is missing the instagram_business_manage_comments permission needed to send private replies."
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return INSTAGRAM_RATE_LIMIT_REASON
  }
  if (code === 368) return INSTAGRAM_BLOCKED_REASON
  return null
}

// La respuesta pública devuelve `{"id": "<nuevo-ig-comment-id>"}`, no un
// `message_id`: es un comentario y no un mensaje, así que se lee distinto que la
// respuesta de un DM.
export function extractPublishedCommentId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const id = (data as { id?: unknown }).id
  return typeof id === "string" && id.length > 0 ? id : null
}
