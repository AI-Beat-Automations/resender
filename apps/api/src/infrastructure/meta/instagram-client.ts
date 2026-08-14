import { ContractError } from "@workspace/contracts"

import { META_GRAPH_VERSION, META_TIMEOUT_MS } from "../../config"

// Cliente de **Instagram API con Instagram Login**. No es una variante del de
// Facebook: es otro protocolo, y casi nada del `MetaClient` se podía reusar.
//
// | | Facebook Login for Business | Instagram Login |
// |---|---|---|
// | Diálogo | `facebook.com/<v>/dialog/oauth` | `instagram.com/oauth/authorize` |
// | Permisos | en el `config_id` | en `scope`, explícitos |
// | Intercambio | `graph.facebook.com` | `api.instagram.com` + `graph.instagram.com` |
// | Secreto | `META_APP_SECRET` | `INSTAGRAM_APP_SECRET` |
// | Devuelve | N páginas a elegir | **una** cuenta |
// | Token | no vence | ~60 días, se refresca |
const GRAPH = "https://graph.instagram.com"
const OAUTH_HOST = "https://api.instagram.com"

// Los campos del webhook a los que se suscribe la cuenta. Deliberadamente no
// incluye `messaging_postbacks`: con Instagram Login no existen, y suscribirse a
// un campo que no llega deja el parser con una rama muerta.
const SUBSCRIBED_FIELDS = "messages,comments"

// Instagram corta el texto de un DM en **1000 bytes UTF-8**, no en 1000
// caracteres. En español la diferencia es real: cada acento son 2 bytes y cada
// emoji 4, así que un control por longitud dejaría pasar texto que Meta rechaza.
export const INSTAGRAM_TEXT_MAX_BYTES = 1000

// Un comentario admite 2200 **caracteres**, el mismo techo que un pie de foto.
// Dos superficies de Instagram, dos límites, dos unidades.
export const INSTAGRAM_COMMENT_MAX_CHARS = 2200

export function instagramTextByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function instagramCommentLength(text: string): number {
  // Por code points y no por `text.length`, que cuenta unidades UTF-16: un emoji
  // fuera del plano básico son dos unidades y un solo carácter.
  return [...text].length
}

export type InstagramProfile = {
  // El IG ID de la cuenta profesional. **No** es el `id` que devuelve Graph por
  // defecto, que es app-scoped: el que llega como `entry.id` en el webhook es
  // `user_id`, y guardar el equivocado deja la cuenta conectada y muda, con un
  // síntoma que no señala la causa.
  providerAccountId: string
  username: string
  name: string
}

export type InstagramToken = {
  accessToken: string
  // Los tokens de Instagram vencen a los ~60 días; los page tokens de Messenger
  // no. Esta fecha es la que lee el refresh.
  expiresAt: Date | null
}

export type InstagramSendResult =
  | { ok: true; messageId: string; response: unknown }
  | {
      ok: false
      kind: "invalid_token" | "rejected" | "unavailable"
      message: string
      response: unknown
    }

export type InstagramCommentResult =
  | { ok: true; commentId: string; response: unknown }
  | {
      ok: false
      kind: "invalid_token" | "rejected" | "unavailable"
      message: string
      response: unknown
    }

export class InstagramClient {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  // Intercambio del código por un token de larga duración, en dos pasos porque
  // Instagram no da uno largo de entrada.
  async exchangeAuthorizationCode(input: {
    code: string
    redirectUri: string
  }): Promise<InstagramToken> {
    // **El `code` viene con `#_` pegado al final** y ese sufijo no es parte del
    // código. Sin quitarlo el intercambio falla con un error que no nombra la
    // causa.
    const code = input.code.replace(/#_$/u, "")

    const shortLived = await this.postForm(
      `${OAUTH_HOST}/oauth/access_token`,
      {
        client_id: this.appId,
        client_secret: this.appSecret,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
        code,
      },
      "Instagram did not return an access token."
    )
    const shortToken = requiredString(
      unwrap(shortLived)?.access_token,
      "Instagram did not return an access token."
    )

    const longLived = await this.getJson(
      `${GRAPH}/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: this.appSecret,
        access_token: shortToken,
      }).toString()}`
    )
    const record = unwrap(longLived)
    return {
      accessToken: requiredString(
        record?.access_token,
        "Instagram did not return a long-lived access token."
      ),
      expiresAt: expiryFrom(record?.expires_in),
    }
  }

  async getProfile(accessToken: string): Promise<InstagramProfile> {
    // `fields` explícito y no el default: sin pedir `user_id` Graph devuelve
    // solo el `id` app-scoped, que no es el que llega en el webhook.
    const body = await this.getJson(
      `${GRAPH}/${META_GRAPH_VERSION}/me?${new URLSearchParams({
        fields: "user_id,username,name",
        access_token: accessToken,
      }).toString()}`
    )
    const record = unwrap(body)
    const username = requiredString(
      record?.username,
      "Instagram did not return the account username."
    )
    return {
      providerAccountId: requiredString(
        record?.user_id,
        "Instagram did not return the professional account id."
      ),
      username,
      // El nombre visible es opcional del lado de Instagram; el @handle no. Si
      // falta, el handle es el mejor nombre disponible y evita una fila con el
      // nombre vacío.
      name:
        typeof record?.name === "string" && record.name.trim()
          ? record.name.trim()
          : username,
    }
  }

  // Contraparte del vencimiento que guarda `token_expires_at`. Todavía no lo
  // llama nadie, pero pertenece al mismo cliente que produce el token.
  async refreshToken(accessToken: string): Promise<InstagramToken> {
    const body = await this.getJson(
      `${GRAPH}/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: accessToken,
      }).toString()}`
    )
    const record = unwrap(body)
    return {
      accessToken: requiredString(
        record?.access_token,
        "Instagram did not return a refreshed access token."
      ),
      expiresAt: expiryFrom(record?.expires_in),
    }
  }

  async subscribeAccount(accessToken: string): Promise<void> {
    // Sin id en el path: el token ya identifica a la cuenta. Es la diferencia
    // con Messenger, donde la suscripción va contra `/<page-id>/subscribed_apps`.
    await this.postForm(
      `${GRAPH}/${META_GRAPH_VERSION}/me/subscribed_apps`,
      { subscribed_fields: SUBSCRIBED_FIELDS, access_token: accessToken },
      "Instagram rejected the webhook subscription."
    )
  }

  async unsubscribeAccount(accessToken: string): Promise<void> {
    await this.request(
      `${GRAPH}/${META_GRAPH_VERSION}/me/subscribed_apps?${new URLSearchParams({
        access_token: accessToken,
      }).toString()}`,
      { method: "DELETE" },
      "Instagram rejected the webhook unsubscription."
    )
  }

  // Envío de un DM. Tres diferencias con la Send API de Messenger que no son
  // cosméticas: host y path (`/me/messages`, sin id porque el token identifica a
  // la cuenta), el token en el header `Authorization` en vez de en la query, y
  // **sin `messaging_type`**, que es un campo de Messenger y mandarlo es pedir
  // un rechazo.
  async sendText(input: {
    accessToken: string
    recipientId: string
    text: string
  }): Promise<InstagramSendResult> {
    return this.sendMessagePayload(input.accessToken, {
      recipient: { id: input.recipientId },
      message: { text: input.text },
    })
  }

  // Respuesta **privada** a un comentario: es un DM, pero `recipient.comment_id`
  // en vez de `recipient.id` es lo que le dice a Meta que el envío se ampara en
  // el comentario y no en la ventana de 24 horas. Es la única manera de
  // escribirle primero a alguien que nunca mandó un DM.
  async sendPrivateReply(input: {
    accessToken: string
    providerCommentId: string
    text: string
  }): Promise<InstagramSendResult> {
    return this.sendMessagePayload(input.accessToken, {
      recipient: { comment_id: input.providerCommentId },
      message: { text: input.text },
    })
  }

  // Respuesta **pública**: se publica como comentario anidado. El id del
  // comentario va en el path —acá el token dice quién responde y el path a
  // qué—, y el texto va en el cuerpo form-encoded en vez de en la query, que es
  // como lo muestra la documentación: así no termina en ningún log de URLs.
  async replyToComment(input: {
    accessToken: string
    providerCommentId: string
    text: string
  }): Promise<InstagramCommentResult> {
    const url = `${GRAPH}/${META_GRAPH_VERSION}/${encodeURIComponent(
      input.providerCommentId
    )}/replies`
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ message: input.text }).toString(),
      })
      const body = await parseJson(response)
      if (response.ok) {
        // La respuesta pública devuelve `{"id": ...}`, no un `message_id`: es un
        // comentario y no un mensaje.
        const commentId = readString(body, "id")
        return commentId
          ? { ok: true, commentId, response: body }
          : {
              ok: false,
              kind: "unavailable",
              message: "Instagram returned an incomplete response.",
              response: body,
            }
      }
      return {
        ...classifyFailure(response, body),
        message: explainCommentError(body) ?? instagramError(body).message,
        response: body,
      }
    } catch (error) {
      return unavailable(error)
    }
  }

  private async sendMessagePayload(
    accessToken: string,
    payload: Record<string, unknown>
  ): Promise<InstagramSendResult> {
    try {
      const response = await this.fetcher(
        `${GRAPH}/${META_GRAPH_VERSION}/me/messages`,
        {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(META_TIMEOUT_MS),
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      )
      const body = await parseJson(response)
      if (response.ok) {
        const messageId = readString(body, "message_id")
        return messageId
          ? { ok: true, messageId, response: body }
          : {
              ok: false,
              kind: "unavailable",
              message: "Instagram returned an incomplete response.",
              response: body,
            }
      }
      const isPrivateReply = "comment_id" in (payload.recipient as object)
      return {
        ...classifyFailure(response, body),
        message:
          (isPrivateReply
            ? explainPrivateReplyError(body)
            : explainMessageError(body)) ?? instagramError(body).message,
        response: body,
      }
    } catch (error) {
      return unavailable(error)
    }
  }

  private async getJson(url: string): Promise<unknown> {
    return this.request(url, { method: "GET" }, "Instagram request failed.")
  }

  private async postForm(
    url: string,
    parameters: Record<string, string>,
    failureMessage: string
  ): Promise<unknown> {
    return this.request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(parameters).toString(),
      },
      failureMessage
    )
  }

  private async request(
    url: string,
    init: RequestInit,
    failureMessage: string
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
      })
    } catch {
      throw new ContractError({
        code: "provider_unavailable",
        message: "Instagram is temporarily unavailable.",
        status: 502,
      })
    }
    const body = await parseJson(response)
    if (!response.ok) {
      const transient = response.status >= 500 || response.status === 429
      throw new ContractError({
        code: transient ? "provider_unavailable" : "provider_rejected",
        message: instagramError(body).message || failureMessage,
        status: transient ? 502 : 422,
      })
    }
    return body
  }
}

// Tres catálogos y no uno. Los códigos son los del sobre de Graph y varios
// coinciden, pero **lo que el usuario tiene que hacer es distinto**, y ese es el
// punto de traducir un error: en Messenger un 190 significa que revocaron
// permisos, en Instagram que el token venció solo a los ~60 días; un 10 es la
// ventana de 24 h en un DM y un permiso en una respuesta pública, que no tiene
// ventana; un 100 es un IGSID mal formado en un DM y un comentario que ya no se
// puede contestar en una respuesta.
//
// Los tres motivos que no dependen de qué se estaba enviando —token, rate limit
// y bloqueo por política— viven una sola vez.
const TOKEN_EXPIRED =
  "The Instagram access token expired or was revoked. Instagram tokens last about 60 days: reconnect the account."
const RATE_LIMITED = "Meta rate limit reached for this app or account."
const BLOCKED =
  "The account is temporarily blocked from taking this action due to a policy violation on Meta's side."

export function explainMessageError(body: unknown): string | null {
  const { code, subcode } = instagramError(body)
  if (code === null) return null
  if (code === 190) return TOKEN_EXPIRED
  // El subcode de la ventana es distinto del de Messenger (2018278) y es el caso
  // más frecuente de todos en Instagram. Con el catálogo compartido caía en la
  // rama genérica de permisos y mandaba al usuario a revisar algo que está bien.
  if (code === 10 && subcode === 2534022) {
    return "Instagram's 24-hour window is closed: this contact has not messaged the account in the last 24 hours."
  }
  if (code === 10) {
    return "Meta permission error: the app is missing instagram_business_manage_messages for this send."
  }
  if (code === 551) {
    return "This person is not available: they may have blocked the account or deleted the conversation."
  }
  if (code === 100) {
    return "Instagram rejected the request: check that the recipient is an IGSID from a conversation with this account."
  }
  if (isRateLimit(code)) return RATE_LIMITED
  if (code === 368) return BLOCKED
  return null
}

export function explainCommentError(body: unknown): string | null {
  const { code } = instagramError(body)
  if (code === null) return null
  if (code === 190) return TOKEN_EXPIRED
  if (code === 10) {
    return "Meta permission error: the app is missing instagram_business_manage_comments for this account."
  }
  if (code === 100) {
    return "Instagram rejected the comment id: the comment may have been deleted or hidden, or belong to a live video, which cannot be replied to."
  }
  if (isRateLimit(code)) return RATE_LIMITED
  if (code === 368) return BLOCKED
  return null
}

export function explainPrivateReplyError(body: unknown): string | null {
  const { code, subcode } = instagramError(body)
  if (code === null) return null
  if (code === 190) return TOKEN_EXPIRED
  // El rechazo más frecuente de este endpoint, y el que junta cuatro causas
  // distintas bajo un mismo código. Meta no dice cuál fue, así que el mensaje
  // las enumera en vez de afirmar una y mandar al usuario a arreglar algo que
  // está bien.
  if (code === 100 && subcode === 2534025) {
    return "This comment cannot receive a private reply: private replies are allowed within 7 days of the comment, only one per comment, and the comment must still exist and come from someone whose settings accept message requests."
  }
  if (code === 10900) {
    return "This comment already received a private reply. Instagram allows exactly one per comment."
  }
  if (code === 200 && subcode === 2534041) {
    return "The account owner disabled access to direct messages, so no private reply can be sent."
  }
  if (code === 10) {
    return "Meta permission error: the app is missing instagram_business_manage_comments, which private replies require."
  }
  if (isRateLimit(code)) return RATE_LIMITED
  if (code === 368) return BLOCKED
  return null
}

function isRateLimit(code: number): boolean {
  return code === 4 || code === 17 || code === 32 || code === 613
}

function classifyFailure(response: Response, body: unknown) {
  const { code } = instagramError(body)
  return {
    ok: false as const,
    kind:
      code === 190
        ? ("invalid_token" as const)
        : response.status >= 500 || response.status === 429
          ? ("unavailable" as const)
          : ("rejected" as const),
  }
}

function unavailable(error: unknown) {
  return {
    ok: false as const,
    kind: "unavailable" as const,
    message:
      error instanceof Error ? error.message : "Instagram request failed.",
    response: null,
  }
}

// Las respuestas de Instagram Login vienen envueltas en `{"data":[{…}]}` y no
// planas como en la documentación vieja. Se aceptan las dos formas: la
// diferencia es de formato, y atarse a una la rompe en silencio el día que Meta
// unifique.
function unwrap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (Array.isArray(record.data)) {
    const first = record.data[0]
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null
  }
  return record
}

function expiryFrom(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(Date.now() + value * 1000)
    : null
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: { message: "Provider returned a non-JSON response." } }
  }
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === "string" && candidate ? candidate : null
}

function instagramError(value: unknown): {
  code: number | null
  subcode: number | null
  message: string
} {
  const fallback = { code: null, subcode: null, message: "" }
  if (!value || typeof value !== "object") return fallback
  const error = (value as Record<string, unknown>).error
  if (!error || typeof error !== "object") return fallback
  const record = error as Record<string, unknown>
  return {
    code: typeof record.code === "number" ? record.code : null,
    subcode:
      typeof record.error_subcode === "number" ? record.error_subcode : null,
    message:
      typeof record.message === "string"
        ? record.message
        : "Instagram request failed.",
  }
}

function requiredString(value: unknown, message: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value !== "string" || !value) {
    throw new ContractError({
      code: "provider_unavailable",
      message,
      status: 502,
    })
  }
  return value
}
