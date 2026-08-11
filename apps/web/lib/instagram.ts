import { log } from "@/lib/observability/logger"
import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
} from "@/lib/outbound/meta-send"

// Cliente de **Instagram API con Instagram Login** (`graph.instagram.com`), el
// login que no pide Página de Facebook: el usuario autoriza su cuenta
// profesional de Instagram directamente.
//
// Es un OAuth distinto del de `lib/meta.ts`, no una variante:
//
// | | Facebook Login for Business | Instagram Login |
// |---|---|---|
// | Diálogo | `facebook.com/<v>/dialog/oauth` | `instagram.com/oauth/authorize` |
// | Permisos | en el `config_id` | en `scope`, explícitos |
// | Intercambio | `graph.facebook.com` | `api.instagram.com` + `graph.instagram.com` |
// | Secreto | `META_APP_SECRET` | `INSTAGRAM_APP_SECRET` |
// | Devuelve | N páginas a elegir | **una** cuenta, sin pantalla de selección |
// | Token | no vence | vence a los ~60 días, se refresca |
//
// El App Secret de Instagram es **distinto** del de Facebook aunque vivan en la
// misma app de Meta: firma los webhooks de Instagram y es el `client_secret`
// del intercambio. Firmarlos con el de Facebook es el error de configuración
// más común, y es la razón por la que Instagram lleva su propia ruta de webhook.

import { APP_URL } from "@/lib/meta"

const APP_ID = process.env.INSTAGRAM_APP_ID!
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET!

// `graph.instagram.com`, no `graph.facebook.com`: con Instagram Login el token
// no sirve contra el Graph de Facebook.
const GRAPH_VERSION = "v23.0"
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`
// El intercambio del code vive en otro host que el resto de la API, y sin
// versión en el path.
const OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
const LONG_LIVED_TOKEN_URL = "https://graph.instagram.com/access_token"
const REFRESH_TOKEN_URL = "https://graph.instagram.com/refresh_access_token"

// A diferencia de Login for Business, acá los permisos van explícitos en el
// diálogo y no en un `config_id`. Son los tres del alcance de la integración:
// leer el perfil, DMs y comentarios. Publicar contenido queda fuera.
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",")

// `messages` cubre los DMs entrantes y `comments` los comentarios en
// publicaciones. `message_echoes` NO se suscribe: los ecos de los mensajes que
// manda la propia cuenta se descartan igual (etapa 3), así que suscribirse
// sería pagar tráfico para tirarlo.
export const INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS = "messages,comments"

export const INSTAGRAM_STATE_COOKIE = "instagram_oauth_state"

// Mismo valor en el diálogo y en el intercambio, y registrado en Meta →
// Instagram → Configuración de la API con Instagram Login → "URI de redir. de
// OAuth válidas". Si difieren, Instagram responde `redirect_uri` mismatch.
export const INSTAGRAM_REDIRECT_URI = `${APP_URL}/api/meta/instagram/callback`

export class InstagramApiError extends Error {
  constructor(
    message: string,
    public readonly step: string
  ) {
    super(message)
    this.name = "InstagramApiError"
  }
}

export type InstagramAccessToken = {
  accessToken: string
  // Cuándo vence el token de larga duración. Los page tokens de Messenger no
  // vencen; estos sí (~60 días), y esa fecha es lo que lee el job de refresh.
  expiresAt: Date | null
}

export type InstagramProfile = {
  // El **IG ID de la cuenta profesional** (`user_id`), no el id app-scoped
  // (`id`). Es el que llega como `entry.id` en el webhook, así que es el que
  // guardamos en `connected_pages.meta_page_id` y por el que se resuelve
  // cuenta→tenant al recibir un evento.
  igUserId: string
  username: string
  name: string | null
}

// URL del diálogo de autorización. `state` es la defensa CSRF: se siembra en
// una cookie httpOnly en `/start` y se compara en el callback.
export function buildInstagramDialogUrl(state: string) {
  const url = new URL("https://www.instagram.com/oauth/authorize")
  url.searchParams.set("client_id", APP_ID)
  url.searchParams.set("redirect_uri", INSTAGRAM_REDIRECT_URI)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", INSTAGRAM_SCOPES)
  url.searchParams.set("state", state)
  return url.toString()
}

// Instagram devuelve el `code` con un `#_` pegado al final que **no es parte
// del código**. Va documentado como tal, y no quitarlo hace fallar el
// intercambio con un error que no nombra la causa.
export function stripAuthorizationCode(code: string): string {
  return code.replace(/#_$/, "")
}

// Con Instagram Login las respuestas vienen envueltas en `{"data":[{…}]}`,
// mientras que la documentación vieja (y algunos endpoints todavía) devuelven
// el objeto plano. Se aceptan las dos formas: la diferencia es de formato y no
// de contenido, y hacer que el cliente dependa de cuál llegó lo rompería en
// silencio el día que Meta unifique.
export function unwrapInstagramPayload(
  payload: unknown
): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {}

  const record = payload as Record<string, unknown>
  const data = record.data
  if (Array.isArray(data)) {
    const [first] = data
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : {}
  }

  return record
}

// `expires_in` viene en segundos. Null cuando Instagram no lo informa: preferimos
// no saber la fecha antes que inventar una que dispare un refresh a destiempo.
export function resolveTokenExpiry(
  expiresIn: unknown,
  now = new Date()
): Date | null {
  const seconds =
    typeof expiresIn === "number"
      ? expiresIn
      : typeof expiresIn === "string"
        ? Number(expiresIn)
        : Number.NaN

  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(now.getTime() + seconds * 1000)
}

// code -> token corto (~1 h) -> token largo (~60 días).
//
// El paso al token largo falla explícito en vez de caer al corto, igual que en
// el flujo de Facebook: persistir una credencial que muere en una hora deja la
// cuenta conectada y muda, sin ninguna señal de por qué.
export async function exchangeCodeForInstagramToken(
  code: string
): Promise<InstagramAccessToken> {
  const shortRes = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: INSTAGRAM_REDIRECT_URI,
      code: stripAuthorizationCode(code),
    }),
  })
  const shortData = unwrapInstagramPayload(await shortRes.json())
  const shortToken = shortData.access_token
  if (!shortRes.ok || typeof shortToken !== "string") {
    log({
      entrypoint: "route",
      action: "token_exchange",
      outcome: "failed",
      reason: "token_exchange_failed",
      channel: "instagram",
      errorCode: extractMetaErrorCode(shortData) ?? undefined,
      errorMessage: extractMetaErrorMessage(shortData) ?? undefined,
      status: shortRes.status,
    })
    throw new InstagramApiError("token exchange failed", "short_lived_token")
  }

  const longUrl = new URL(LONG_LIVED_TOKEN_URL)
  longUrl.searchParams.set("grant_type", "ig_exchange_token")
  longUrl.searchParams.set("client_secret", APP_SECRET)
  longUrl.searchParams.set("access_token", shortToken)

  const longRes = await fetch(longUrl)
  const longData = unwrapInstagramPayload(await longRes.json())
  const longToken = longData.access_token
  if (!longRes.ok || typeof longToken !== "string") {
    log({
      entrypoint: "route",
      action: "token_exchange",
      outcome: "failed",
      reason: "token_exchange_failed",
      channel: "instagram",
      errorCode: extractMetaErrorCode(longData) ?? undefined,
      errorMessage: extractMetaErrorMessage(longData) ?? undefined,
      status: longRes.status,
    })
    throw new InstagramApiError(
      "long-lived token exchange failed",
      "long_lived_token"
    )
  }

  return {
    accessToken: longToken,
    expiresAt: resolveTokenExpiry(longData.expires_in),
  }
}

// Renueva un token de larga duración por otros ~60 días. No se usa todavía en
// el flujo de conexión; existe acá porque es la contraparte del vencimiento que
// guarda `token_expires_at` y vive en el mismo cliente que lo produjo.
export async function refreshInstagramToken(
  accessToken: string
): Promise<InstagramAccessToken> {
  const url = new URL(REFRESH_TOKEN_URL)
  url.searchParams.set("grant_type", "ig_refresh_token")
  url.searchParams.set("access_token", accessToken)

  const res = await fetch(url)
  const data = unwrapInstagramPayload(await res.json())
  const refreshed = data.access_token
  if (!res.ok || typeof refreshed !== "string") {
    log({
      entrypoint: "route",
      action: "token_exchange",
      outcome: "failed",
      reason: "token_exchange_failed",
      channel: "instagram",
      errorCode: extractMetaErrorCode(data) ?? undefined,
      errorMessage: extractMetaErrorMessage(data) ?? undefined,
      status: res.status,
    })
    throw new InstagramApiError("token refresh failed", "refresh_token")
  }

  return {
    accessToken: refreshed,
    expiresAt: resolveTokenExpiry(data.expires_in),
  }
}

// Perfil de la cuenta autorizada. Pedimos `user_id` explícitamente: el `id` que
// devuelve por defecto es el app-scoped y **no** es el que llega en el webhook.
export async function fetchInstagramProfile(
  accessToken: string
): Promise<InstagramProfile> {
  const url = new URL(`${GRAPH}/me`)
  url.searchParams.set("fields", "user_id,username,name")
  url.searchParams.set("access_token", accessToken)

  const res = await fetch(url)
  const data = unwrapInstagramPayload(await res.json())
  const igUserId = data.user_id
  const username = data.username

  if (!res.ok || !igUserId || !username) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "profile_fetch_failed",
      channel: "instagram",
      errorCode: extractMetaErrorCode(data) ?? undefined,
      errorMessage: extractMetaErrorMessage(data) ?? undefined,
      status: res.status,
    })
    throw new InstagramApiError("profile fetch failed", "profile")
  }

  return {
    igUserId: String(igUserId),
    username: String(username),
    name: typeof data.name === "string" && data.name ? data.name : null,
  }
}

// Suscribe la cuenta al webhook del app. A diferencia de Messenger, el endpoint
// es `/me/subscribed_apps` y no `/{pageId}/subscribed_apps`: el token ya
// identifica a la cuenta, así que no hay id que pasar.
export async function subscribeInstagramWebhook(
  accessToken: string
): Promise<void> {
  const res = await fetch(`${GRAPH}/me/subscribed_apps`, {
    method: "POST",
    body: new URLSearchParams({
      subscribed_fields: INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS,
      access_token: accessToken,
    }),
  })
  const data = unwrapInstagramPayload(await res.json())
  if (!res.ok || data.success !== true) {
    log({
      entrypoint: "route",
      action: "webhook_subscribe",
      outcome: "failed",
      reason: "subscription_failed",
      channel: "instagram",
      // Sin `accountId`: el endpoint es `/me/subscribed_apps` y la cuenta sale
      // del token, así que esta función no la conoce. El llamador la nombra.
      errorCode: extractMetaErrorCode(data) ?? undefined,
      errorMessage: extractMetaErrorMessage(data) ?? undefined,
      status: res.status,
    })
    throw new InstagramApiError("webhook subscription failed", "subscribe")
  }
}

// Desuscribe la cuenta, best-effort al desconectarla o al borrar el tenant: si
// falla, el resto de la baja sigue igual. Devuelve si Meta lo confirmó, en vez
// de lanzar, porque ningún llamador puede hacer nada con el error.
export async function unsubscribeInstagramWebhook(
  accessToken: string
): Promise<boolean> {
  // Graph espera el access_token en query en un DELETE; el body de un DELETE se
  // pierde en varios stacks.
  const url = new URL(`${GRAPH}/me/subscribed_apps`)
  url.searchParams.set("access_token", accessToken)

  const res = await fetch(url, { method: "DELETE" })
  const data = unwrapInstagramPayload(await res.json())
  if (!res.ok || data.success !== true) {
    log({
      entrypoint: "route",
      action: "webhook_unsubscribe",
      outcome: "failed",
      reason: "unsubscribe_failed",
      channel: "instagram",
      // Sin `accountId`: el endpoint es `/me/subscribed_apps` y la cuenta sale
      // del token, así que esta función no la conoce. El llamador la nombra.
      errorCode: extractMetaErrorCode(data) ?? undefined,
      errorMessage: extractMetaErrorMessage(data) ?? undefined,
      status: res.status,
    })
    return false
  }
  return true
}
