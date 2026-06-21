// Configuración y helpers del flujo OAuth de Meta (Facebook Login for Business).
// Flujo basado en REDIRECCIÓN (no el popup del JS SDK): el `redirect_uri` que se
// usa al intercambiar el code DEBE ser idéntico al que se usó al abrir el diálogo,
// si no Meta responde OAuthException code 100 / subcode 36008.
const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID!
const APP_SECRET = process.env.META_APP_SECRET!
const CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID!
const GRAPH_VERSION = "v23.0"
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

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

// code -> user token (corto) -> token largo -> páginas con su page access token.
// Lanza Error si algún paso falla (el detalle queda en console.error del servidor).
export async function exchangeCodeForPages(
  code: string
): Promise<ConnectedPage[]> {
  // 1. code -> user access token (corto). redirect_uri = el mismo del diálogo.
  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`)
  tokenUrl.searchParams.set("client_id", APP_ID)
  tokenUrl.searchParams.set("client_secret", APP_SECRET)
  tokenUrl.searchParams.set("redirect_uri", REDIRECT_URI)
  tokenUrl.searchParams.set("code", code)

  const tokenRes = await fetch(tokenUrl)
  const tokenData = await tokenRes.json()
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error("token exchange failed", tokenData)
    throw new Error("token exchange failed")
  }
  const shortToken = tokenData.access_token

  // 2. corto -> largo (long-lived); si falla, caemos al corto
  const longUrl = new URL(`${GRAPH}/oauth/access_token`)
  longUrl.searchParams.set("grant_type", "fb_exchange_token")
  longUrl.searchParams.set("client_id", APP_ID)
  longUrl.searchParams.set("client_secret", APP_SECRET)
  longUrl.searchParams.set("fb_exchange_token", shortToken)

  const longRes = await fetch(longUrl)
  const longData = await longRes.json()
  const userToken = longData.access_token ?? shortToken

  // 3. páginas autorizadas + su page access token
  const pagesUrl = new URL(`${GRAPH}/me/accounts`)
  pagesUrl.searchParams.set("fields", "id,name,access_token")
  pagesUrl.searchParams.set("access_token", userToken)

  const pagesRes = await fetch(pagesUrl)
  const pagesData = await pagesRes.json()
  if (!pagesRes.ok) {
    console.error("pages fetch failed", pagesData)
    throw new Error("pages fetch failed")
  }

  type GraphPage = { id: string; name: string; access_token: string }
  return ((pagesData.data ?? []) as GraphPage[]).map((p) => ({
    pageId: p.id,
    name: p.name,
    pageAccessToken: p.access_token,
  }))
}

// Suscribe una página al webhook del app (campos messages / postbacks). Requiere
// el page access token y el permiso pages_manage_metadata en el config_id.
export async function subscribeToWebhook(
  pageId: string,
  pageAccessToken: string
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: "POST",
    body: new URLSearchParams({
      subscribed_fields: "messages,messaging_postbacks",
      access_token: pageAccessToken,
    }),
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    console.error("subscribed_apps failed", pageId, data)
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
        console.error("subscribed_apps failed", page.pageId, error)
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
  pageId: string,
  pageAccessToken: string
): Promise<boolean> {
  // Graph espera el access_token como query param en DELETE; algunos stacks
  // descartan el body de una request DELETE.
  const url = new URL(`${GRAPH}/${pageId}/subscribed_apps`)
  url.searchParams.set("access_token", pageAccessToken)
  const res = await fetch(url, { method: "DELETE" })
  const data = await res.json()
  if (!res.ok || !data.success) {
    console.error("subscribed_apps unsubscribe failed", pageId, data)
    return false
  }
  return true
}
