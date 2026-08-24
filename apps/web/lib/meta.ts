import { describeError, log } from "@/lib/observability/logger"
import type { PageChannel } from "@/lib/pages/page-registry"
import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
  extractMetaErrorSubcode,
} from "@/lib/outbound/meta-send"

// Configuración y helpers del flujo OAuth de Meta (Facebook Login for Business).
// Flujo basado en REDIRECCIÓN (no el popup del JS SDK): el `redirect_uri` que se
// usa al intercambiar el code DEBE ser idéntico al que se usó al abrir el diálogo,
// si no Meta responde OAuthException code 100 / subcode 36008.
const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID!
const APP_SECRET = process.env.META_APP_SECRET!
const CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID!
const GRAPH_VERSION = "v23.0"
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
export const META_WEBHOOK_SUBSCRIBED_FIELDS =
  "messages,messaging_postbacks,messaging_policy_enforcement"

// Origen público de la app (en dev, la URL https de ngrok). Lo usamos para armar
// el redirect_uri y para volver a la home; así no dependemos de cómo Next infiera
// el host detrás del túnel.
export const APP_URL = process.env.APP_URL!

// Mismo valor en el diálogo y en el intercambio. Debe estar registrado en
// Meta → Facebook Login → "URI de redireccionamiento de OAuth válidos".
export const REDIRECT_URI = `${APP_URL}/api/meta/callback`

export const STATE_COOKIE = "meta_oauth_state"

// URL del diálogo de OAuth (flujo de redirección). Con Login for Business los
// permisos van en el config_id, por eso no pasamos `scope`.
export function buildDialogUrl(state: string) {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set("client_id", APP_ID)
  url.searchParams.set("config_id", CONFIG_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("state", state)
  return url.toString()
}

export type ConnectedPage = {
  pageId: string
  name: string
  pageAccessToken: string
}

export class WebhookSubscriptionError extends Error {
  constructor(public readonly failedPageIds: string[]) {
    super("webhook subscription failed")
    this.name = "WebhookSubscriptionError"
  }
}

// code -> user access token (corto) -> user access token de larga duración.
// Lanza Error si algún paso falla; el detalle queda en el log estructurado.
//
// **Nunca se loguea el body crudo de Graph.** `/me/accounts` devuelve un
// `access_token` por página, y aunque en un no-2xx lo que viene es un sobre de
// error, un cambio de comportamiento de Meta bastaría para volcar tokens a los
// logs. Se extraen el código y el mensaje, que es lo único que sirve.
export async function exchangeCodeForUserToken(code: string): Promise<string> {
  // 1. code -> user access token (corto). redirect_uri = el mismo del diálogo.
  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`)
  tokenUrl.searchParams.set("client_id", APP_ID)
  tokenUrl.searchParams.set("client_secret", APP_SECRET)
  tokenUrl.searchParams.set("redirect_uri", REDIRECT_URI)
  tokenUrl.searchParams.set("code", code)

  const tokenRes = await fetch(tokenUrl)
  const tokenData = await tokenRes.json()
  if (!tokenRes.ok || !tokenData.access_token) {
    log({
      entrypoint: "route",
      action: "token_exchange",
      outcome: "failed",
      reason: "token_exchange_failed",
      channel: "messenger",
      errorCode: extractMetaErrorCode(tokenData) ?? undefined,
      errorSubcode: extractMetaErrorSubcode(tokenData) ?? undefined,
      errorMessage: extractMetaErrorMessage(tokenData) ?? undefined,
      status: tokenRes.status,
    })
    throw new Error("token exchange failed")
  }
  const shortToken = tokenData.access_token

  // 2. corto -> largo (long-lived). Falla explícito: antes se caía en silencio
  // al token corto, y ese token se persiste (ADR 0004). Guardar una credencial
  // que muere en ~1 hora rompería la selección de páginas sin señal clara.
  const longUrl = new URL(`${GRAPH}/oauth/access_token`)
  longUrl.searchParams.set("grant_type", "fb_exchange_token")
  longUrl.searchParams.set("client_id", APP_ID)
  longUrl.searchParams.set("client_secret", APP_SECRET)
  longUrl.searchParams.set("fb_exchange_token", shortToken)

  const longRes = await fetch(longUrl)
  const longData = await longRes.json()
  if (!longRes.ok || !longData.access_token) {
    log({
      entrypoint: "route",
      action: "token_exchange",
      outcome: "failed",
      reason: "token_exchange_failed",
      channel: "messenger",
      errorCode: extractMetaErrorCode(longData) ?? undefined,
      errorSubcode: extractMetaErrorSubcode(longData) ?? undefined,
      errorMessage: extractMetaErrorMessage(longData) ?? undefined,
      status: longRes.status,
    })
    throw new Error("long-lived token exchange failed")
  }

  return longData.access_token as string
}

// Páginas que el usuario administra + su page access token. Se vuelve a llamar
// al confirmar la selección, así los tokens de las páginas descartadas nunca
// tocan la base.
export async function listAuthorizedPages(
  userAccessToken: string
): Promise<ConnectedPage[]> {
  const pagesUrl = new URL(`${GRAPH}/me/accounts`)
  pagesUrl.searchParams.set("fields", "id,name,access_token")
  pagesUrl.searchParams.set("access_token", userAccessToken)

  const pagesRes = await fetch(pagesUrl)
  const pagesData = await pagesRes.json()
  if (!pagesRes.ok) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "profile_fetch_failed",
      channel: "messenger",
      errorCode: extractMetaErrorCode(pagesData) ?? undefined,
      errorMessage: extractMetaErrorMessage(pagesData) ?? undefined,
      status: pagesRes.status,
    })
    throw new Error("pages fetch failed")
  }

  type GraphPage = { id: string; name: string; access_token: string }
  return ((pagesData.data ?? []) as GraphPage[]).map((p) => ({
    pageId: p.id,
    name: p.name,
    pageAccessToken: p.access_token,
  }))
}

// Suscribe una página al webhook del app. Requiere el page access token y el
// permiso pages_manage_metadata en el config_id.
export async function subscribeToWebhook(
  pageId: string,
  pageAccessToken: string
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: "POST",
    body: new URLSearchParams({
      subscribed_fields: META_WEBHOOK_SUBSCRIBED_FIELDS,
      access_token: pageAccessToken,
    }),
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    log({
      entrypoint: "route",
      action: "webhook_subscribe",
      outcome: "failed",
      reason: "subscription_failed",
      channel: "messenger",
      accountId: pageId,
      errorCode: extractMetaErrorCode(data) ?? undefined,
      errorMessage: extractMetaErrorMessage(data) ?? undefined,
      status: res.status,
    })
    return false
  }
  return true
}

export async function subscribePagesToWebhook(pages: ConnectedPage[]) {
  if (pages.length === 0) return

  const results = await Promise.all(
    pages.map(async (page) => {
      try {
        const ok = await subscribeToWebhook(page.pageId, page.pageAccessToken)
        return { pageId: page.pageId, ok }
      } catch (error) {
        log({
          entrypoint: "route",
          action: "webhook_subscribe",
          outcome: "failed",
          reason: "subscription_failed",
          channel: "messenger",
          accountId: page.pageId,
          errorMessage: describeError(error),
        })
        return { pageId: page.pageId, ok: false }
      }
    })
  )

  const failedPageIds = results
    .filter((result) => !result.ok)
    .map((result) => result.pageId)

  if (failedPageIds.length > 0) {
    throw new WebhookSubscriptionError(failedPageIds)
  }
}

// Desuscribe una página del webhook del app. Se usa best-effort al eliminar la
// cuenta del tenant: si falla, el borrado de datos continúa igual.
export async function unsubscribeFromWebhook(
  nodeId: string,
  pageAccessToken: string,
  // De qué canal es la baja, solo para que el fallo no se registre siempre como
  // de Messenger. La llamada es idéntica en los dos: WhatsApp usa este mismo
  // `DELETE /{id}/subscribed_apps` del Graph de Facebook —donde vive Cloud
  // API— pero con el id del WABA en lugar del page id.
  channel: Extract<PageChannel, "messenger" | "whatsapp"> = "messenger"
): Promise<boolean> {
  // Graph espera el access_token como query param en DELETE; algunos stacks
  // descartan el body de una request DELETE.
  const url = new URL(`${GRAPH}/${nodeId}/subscribed_apps`)
  url.searchParams.set("access_token", pageAccessToken)
  const res = await fetch(url, { method: "DELETE" })
  const data = await res.json()
  if (!res.ok || !data.success) {
    log({
      entrypoint: "route",
      action: "webhook_unsubscribe",
      outcome: "failed",
      reason: "unsubscribe_failed",
      channel,
      accountId: nodeId,
      errorCode: extractMetaErrorCode(data) ?? undefined,
      errorMessage: extractMetaErrorMessage(data) ?? undefined,
      status: res.status,
    })
    return false
  }
  return true
}
