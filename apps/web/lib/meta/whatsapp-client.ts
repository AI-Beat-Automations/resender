import { GRAPH_FACEBOOK_BASE } from "@/lib/meta/graph-version"
import type { LogAction, LogReason } from "@/lib/observability/logger"
import { describeError, log } from "@/lib/observability/logger"
import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
  extractMetaErrorSubcode,
  type MetaSendResult,
} from "@/lib/outbound/meta-send"

// Cliente de **WhatsApp Cloud API**: onboarding por Embedded Signup (flujo
// estándar y Coexistence, como Tech Provider y sin BSP), media entrante y envío.
//
// WhatsApp vive en la **misma Meta App que Messenger** —Instagram es la
// excepción, y por eso tiene su propio secreto—, así que el `client_id` y el
// `client_secret` del intercambio son los de `lib/meta.ts`. Lo que cambia es
// casi todo lo demás:
//
// | | Messenger (lib/meta) | WhatsApp (este módulo) |
// |---|---|---|
// | Diálogo | redirección a `dialog/oauth` | popup del JS SDK (`FB.login`) |
// | `redirect_uri` | obligatorio e idéntico | **no se envía** |
// | Vida del `code` | minutos | **30 segundos** |
// | Token | de usuario, largo | de negocio (system user) |
// | Ids de la cuenta | los devuelve Graph | los **dice el navegador** |
// | Suscripción | `/{pageId}/subscribed_apps` | `/{wabaId}/subscribed_apps` |
// | Alta del número | no existe | `/{phoneNumberId}/register` con PIN |
// | Envío | token en el query | token en `Authorization` |
// | Id del mensaje | `message_id` | `messages[0].id` (`wamid…`) |
//
// **La regla que ordena el módulo entero: lo que dice el navegador no es
// autoritativo.** Embedded Signup manda el `waba_id` y el `phone_number_id` por
// `postMessage`, que es telemetría de cliente: cualquiera puede fabricarla desde
// la consola, y el propio ejemplo de Meta valida el origen con
// `endsWith('facebook.com')` —que acepta `evilfacebook.com`—. Si persistiéramos
// esos ids tal cual, un tenant podría reclamar el número de otro con un POST a
// nuestra ruta de callback. Por eso el `postMessage` entra acá como *pista*
// (`WhatsappSignupHint`) y sale confirmado contra Graph con el token recién
// canjeado: `debug_token` dice qué WABAs compartió de verdad el cliente, y
// `/{waba_id}/phone_numbers` es la única fuente de verdad del `phone_number_id`.
// El `code` sí es prueba de consentimiento —es criptográficamente canjeable—,
// así que el token que sale de él es el que manda.
//
// **Los dos flujos comparten casi todo y se separan en un punto.** El canje, la
// validación de assets y la lectura del WABA son idénticos; a partir de ahí:
//
// - **estándar**: suscribe el WABA y **registra** el número con `/register`, que
//   es lo que le activa la verificación en dos pasos con nuestro PIN;
// - **Coexistence**: suscribe el WABA **con los tres campos** (`history`,
//   `smb_app_state_sync`, `smb_message_echoes`), **no registra nada** —el número
//   ya opera desde la app de WhatsApp Business y registrarlo lo sacaría de ahí—
//   y pide el history sync, que es lo que arranca el reloj de 24 horas.

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID!
const APP_SECRET = process.env.META_APP_SECRET!

// Cloud API vive en el Graph de Facebook, no en un host propio como Instagram.
// La versión sale de `lib/meta/graph-version.ts` y no se escribe acá: el test
// «no hardcodea ninguna versión» lo fija leyendo este mismo archivo.
const GRAPH = GRAPH_FACEBOOK_BASE

// Cuánto se espera a Graph. Mismo valor que el resto de los clientes salientes
// (`meta-send.ts`, `instagram-send.ts`): un onboarding que se cuelga es peor que
// uno que falla, porque el `code` se muere igual a los 30 segundos y el usuario
// se queda mirando una pantalla que no dice nada.
const GRAPH_TIMEOUT_MS = 10_000

// La descarga de bytes tiene su propio plazo: un documento de Cloud API llega
// hasta 100 MB y 10 segundos no alcanzan ni de lejos. La URL temporal vive 5
// minutos, así que el techo real lo pone Meta y no nosotros.
const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000

// Los dos permisos del Configuration ID de Embedded Signup: `management` para
// leer el WABA y suscribir la app, `messaging` para enviar y recibir. Sin los
// dos el onboarding termina en una conexión que se conecta y no habla.
export const WHATSAPP_REQUIRED_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const

// Los tres campos de Coexistence. **Hay que suscribirlos antes de onboardear el
// número**, no después: `history` es el que trae el historial que el negocio
// aceptó compartir, y si la suscripción llega tarde los chunks que Meta ya
// disparó no vuelven —el sync se pide una vez y el reloj de 24 horas no se
// reinicia—.
//
// `smb_app_state_sync` trae los cambios de contactos y `smb_message_echoes` los
// mensajes que el negocio manda **desde la app**; los que salen por Cloud API no
// producen echo, así que no hay doble canal que deduplicar.
export const WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS = [
  "history",
  "smb_app_state_sync",
  "smb_message_echoes",
] as const

// "Two-step verification PIN incorrect." Es el único subcódigo del registro que
// tiene una acción clara del lado del cliente, y está documentado verbatim en la
// tabla de errores de Cloud API. El resto de los códigos del canje **no están
// documentados** por Meta, así que este módulo no los adivina: mapea por
// ausencia del campo esperado en la respuesta y deja el código crudo en el log
// para descubrirlos empíricamente.
export const WHATSAPP_PIN_INCORRECT_CODE = 133005

// El texto de Cloud API se mide en **caracteres**, no en bytes: son 4096, y a
// diferencia de Instagram —que cuenta 1000 bytes UTF-8, donde un acento son 2 y
// un emoji 4— acá un emoji ocupa lo mismo que una letra.
export const WHATSAPP_TEXT_MAX_CHARS = 4096

export function exceedsWhatsappTextLimit(text: string): boolean {
  return [...text].length > WHATSAPP_TEXT_MAX_CHARS
}

// Los pasos del onboarding, en el orden en que ocurren. `persist` no lo ejecuta
// este módulo —la persistencia cifrada es de la ruta que lo llama—, pero está en
// la unión para que el callback pueda reportar un único `step` sin inventarse un
// valor cuando lo que falla es la escritura. `sync_request` es de Coexistence:
// va después de `subscribe` y en lugar de `register`.
export type WhatsappOnboardingStep =
  | "exchange"
  | "assets"
  | "register"
  | "subscribe"
  | "sync_request"
  | "persist"

// Por qué falló, dentro del paso. El `step` sirve para el log y para saber dónde
// se cortó; el `reason` es lo que decide el mensaje de la pantalla: `pin_required`
// pide el PIN del cliente, `waba_not_shared` es un intento de reclamar una cuenta
// ajena, y `network_error` es un reintentable.
export type WhatsappFailureReason =
  | "code_exchange_failed"
  | "token_invalid"
  | "missing_permissions"
  | "waba_not_shared"
  | "waba_mismatch"
  | "missing_phone_number_id"
  | "phone_not_in_waba"
  | "subscription_failed"
  | "pin_required"
  | "registration_failed"
  // Coexistence: ninguno de los tres es reintentable sin cambiar algo del lado
  // del cliente, y por eso no comparten motivo con `missing_phone_number_id`.
  | "coexistence_number_not_found"
  | "coexistence_number_ambiguous"
  | "coexistence_number_not_linked"
  | "history_sync_failed"
  // Media entrante: el sobre con la URL temporal y la descarga de los bytes
  // fallan por motivos distintos y se cuentan por separado.
  | "media_not_found"
  | "media_download_failed"
  | "network_error"

export type WhatsappOnboardingMode = "standard" | "coexistence"

// Mismo patrón que `InstagramApiError`: el `step` es lo que el callback traduce
// a un mensaje accionable. Lleva dos campos más porque acá un mismo paso tiene
// desenlaces que la pantalla trata distinto —el 133005 pide un dato al cliente,
// un 500 de Meta pide reintentar— y distinguirlos por el texto del mensaje sería
// volver a parsear strings.
export class WhatsappApiError extends Error {
  constructor(
    message: string,
    public readonly step: WhatsappOnboardingStep,
    public readonly reason: WhatsappFailureReason,
    // Código de Meta cuando lo hubo. Nunca el body: ver `logMetaFailure`.
    public readonly metaErrorCode: number | null = null
  ) {
    super(message)
    this.name = "WhatsappApiError"
  }
}

// Lo que dijo el navegador. No es autoritativo: es lo que hay que **confirmar**.
// `phoneNumberId` es opcional porque el `postMessage` de Coexistence sólo trae
// `waba_id`; en el flujo estándar viene siempre y su ausencia es un error.
export type WhatsappSignupHint = {
  wabaId: string
  phoneNumberId?: string | null
}

export type WhatsappTokenDebug = {
  // Cuándo vence el business token, o `null` si no vence. Ver
  // `resolveWhatsappTokenExpiry`.
  expiresAt: Date | null
  scopes: string[]
  // WABAs que el cliente compartió de verdad con nuestra app, según los
  // `granular_scopes` de los permisos de WhatsApp.
  sharedWabaIds: string[]
}

export type WhatsappBusinessAccount = {
  id: string
  name: string | null
}

export type WhatsappPhoneNumber = {
  // El `phone_number_id`: el id con el que se envía, se registra y con el que
  // llegan los webhooks. Es lo que `connected_pages.meta_page_id` guarda en este
  // canal.
  id: string
  // Tal cual lo devuelve Meta, con espacios y guiones: `+1 631-555-5555`.
  displayPhoneNumber: string | null
  // El mismo número normalizado a E.164, que es como lo guarda la base.
  phoneE164: string | null
  // El nombre verificado del negocio, el que ve el destinatario en el chat.
  verifiedName: string | null
  // `true` cuando el número está vinculado a la app de WhatsApp Business, que es
  // la marca de un número de Coexistence. **Ausente cuenta como `false`**: es la
  // lectura que falla cerrado, porque el error de tratar un número normal como
  // Coexistence es no registrarlo y dejar el canal mudo.
  isOnBizApp: boolean
}

export type WhatsappSignupResult = {
  accessToken: string
  // `null` = no vence. Se lee de `debug_token`, no se asume: ver
  // `resolveWhatsappTokenExpiry`.
  tokenExpiresAt: Date | null
  wabaId: string
  wabaName: string | null
  phoneNumberId: string
  phoneE164: string | null
  verifiedName: string | null
  // El PIN de verificación en dos pasos del número. **El llamador tiene que
  // persistirlo cifrado**: hace falta en cualquier re-registro futuro y no hay
  // forma de recuperarlo de Meta. Acá sólo se genera y se devuelve; el cifrado y
  // la escritura son de quien llama.
  //
  // **`null` en Coexistence**, y no un string vacío: ese flujo no llama a
  // `/register`, así que no hay PIN que guardar. La columna
  // `whatsapp_pin_encrypted` de la 0017 es nullable justamente por esto.
  pin: string | null
  // `false` cuando el PIN lo aportó el cliente (número que ya tenía 2FA) o
  // cuando no hay PIN. Sirve para no mostrarle en pantalla un PIN que ya conoce.
  pinGenerated: boolean
  onboardingMode: WhatsappOnboardingMode
  // Sólo en Coexistence: si la solicitud de history sync salió. `null` en el
  // flujo estándar, que no tiene historial que pedir. El llamador lo traduce a
  // `history_sync_status`.
  historySyncRequested: boolean | null
}

// ---------------------------------------------------------------------------
// Helpers de transporte
// ---------------------------------------------------------------------------

// **Las llamadas que usan el token del cliente lo mandan en `Authorization`, no
// en el query ni en el body.** Son todas menos dos —el WABA, sus números, la
// suscripción, el registro, el history sync, la media y el envío—. El registro
// obliga (su body es JSON, así que no hay dónde meter un `access_token=`), y
// usar el mismo mecanismo en todas evita el caso que el logger tiene que limpiar
// a mano en los otros canales: una URL con el token en el query que termina en
// el mensaje de un error.
//
// **Las dos excepciones llevan credenciales en el querystring, y no hay
// alternativa:**
//
// - el canje (`/oauth/access_token`, paso 1) manda `client_secret`. Es la
//   primera llamada del flujo: todavía no existe ningún token que presentar, y
//   la credencial que autentica la petición *es* el secreto de la app. El
//   endpoint de OAuth solo lo lee del query o de un body form-encoded;
// - `debug_token` (paso 2) manda **dos**: el token que se inspecciona
//   (`input_token`, que es el del cliente) y el app token (`APP_ID|APP_SECRET`)
//   con el que se pregunta. Es una llamada sobre un token, no con un token: el
//   inspeccionado es el *sujeto* de la consulta y no tiene otra forma de
//   viajar, así que mover el otro a la cabecera no sacaría el querystring del
//   asunto.
//
// Lo que sí se sostiene en todas, y es lo que de verdad protege: este módulo
// **nunca registra la URL ni el body** (ver `logMetaFailure`), y el logger tacha
// `client_secret=`, `access_token=` y `code=` si alguno se colara dentro del
// mensaje de un error. El test «higiene de secretos» fija las dos mitades: dónde
// va cada credencial y que ninguna sale por el log.
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

// Registra un fallo de Graph **sin el body**. La respuesta del canje trae el
// business token en claro, y `/phone_numbers` trae identificadores del cliente;
// aunque en un no-2xx lo que llega es un sobre de error, basta un cambio de
// comportamiento de Meta para volcar credenciales al log. Se extraen código,
// subcódigo y mensaje, que es lo único que sirve para diagnosticar.
function logMetaFailure(input: {
  action: LogAction
  reason: LogReason
  accountId?: string
  status?: number
  data: Record<string, unknown>
}) {
  log({
    entrypoint: "route",
    action: input.action,
    outcome: "failed",
    reason: input.reason,
    channel: "whatsapp",
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    errorCode: extractMetaErrorCode(input.data) ?? undefined,
    errorSubcode: extractMetaErrorSubcode(input.data) ?? undefined,
    errorMessage: extractMetaErrorMessage(input.data) ?? undefined,
  })
}

// `fetch` + parseo, con el fallo de red ya atribuido a su paso. Sin esto, un
// DNS caído o un timeout salen como un `TypeError` sin `step`, y el callback no
// puede decir en qué punto del onboarding se cortó —que es justo lo que el PRD
// pide registrar—.
//
// El `AbortSignal.timeout` va acá y no en cada llamador para que ninguna llamada
// nueva pueda nacer sin plazo: un `fetch` sin señal se cuelga hasta el timeout
// del runtime, que en un Worker es el de la request entera.
async function graphRequest(
  call: { step: WhatsappOnboardingStep; action: LogAction; accountId?: string },
  input: URL | string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  let response: Response
  try {
    response = await fetch(input, {
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      ...init,
    })
  } catch (error) {
    log({
      entrypoint: "route",
      action: call.action,
      outcome: "failed",
      reason: "network_error",
      channel: "whatsapp",
      ...(call.accountId ? { accountId: call.accountId } : {}),
      errorMessage: describeError(error),
    })
    throw new WhatsappApiError(
      "graph request failed",
      call.step,
      "network_error"
    )
  }

  // Un 502 en HTML de un proxy rompe `json()`. Devolver un objeto vacío hace que
  // el llamador falle por «falta el campo que esperaba», que es la misma
  // conclusión pero con paso y motivo en vez de una excepción anónima.
  const parsed = await response.json().catch(() => null)
  const data =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}

  return { ok: response.ok, status: response.status, data }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  )
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

// Meta manda a veces los numéricos como string (`"file_size": "2048"`). Se
// aceptan las dos formas: la diferencia es de serialización, no de contenido.
function readNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

// ---------------------------------------------------------------------------
// Paso 1 — canje del `code`
// ---------------------------------------------------------------------------

// El `code` de Embedded Signup vive **30 segundos** y es de un solo uso: esta
// llamada es lo primero que hace el callback, sin nada en el medio.
//
// **Sin `redirect_uri`, a diferencia de `lib/meta.ts`.** El flujo de Messenger es
// por redirección y ahí el `redirect_uri` del canje tiene que ser idéntico al del
// diálogo o Meta responde OAuthException 100/36008. Embedded Signup es un popup
// del JS SDK: no hay redirección, el ejemplo oficial no lo incluye, y mandarlo
// sólo puede producir un mismatch con algo que nunca se envió al abrir el flujo.
export async function exchangeWhatsappCode(code: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`)
  url.searchParams.set("client_id", APP_ID)
  url.searchParams.set("client_secret", APP_SECRET)
  url.searchParams.set("code", code)

  const { ok, status, data } = await graphRequest(
    { step: "exchange", action: "token_exchange" },
    url
  )

  const accessToken = data.access_token
  if (!ok || typeof accessToken !== "string" || accessToken.length === 0) {
    logMetaFailure({
      action: "token_exchange",
      reason: "token_exchange_failed",
      status,
      data,
    })
    // Meta no documenta los códigos de este endpoint, así que el criterio es la
    // ausencia del token y no un subcódigo inventado. La causa casi siempre es
    // la misma: pasaron más de 30 segundos, o el code ya se usó.
    throw new WhatsappApiError(
      "code exchange failed",
      "exchange",
      "code_exchange_failed",
      extractMetaErrorCode(data)
    )
  }

  return accessToken
}

// ---------------------------------------------------------------------------
// Paso 2 — `debug_token`: validez, permisos y **propiedad**
// ---------------------------------------------------------------------------

// `expires_at` viene en segundos unix y `0` significa «no caduca».
//
// Se lee en runtime en vez de asumir una duración porque la documentación de
// Meta se contradice consigo misma: Facebook Login for Business dice que los
// tokens de system user "default to never expire", pero la plantilla que Meta
// manda usar para Embedded Signup se llama literalmente "WhatsApp Embedded
// Signup Configuration With 60 Expiration Token" —60 días—. Como para este flujo
// **no hay refresh documentado**, un token que vence obliga a rehacer el
// onboarding: guardar la fecha real es lo único que permite avisar antes en vez
// de enterarse el día 61, con el canal ya mudo.
export function resolveWhatsappTokenExpiry(expiresAt: unknown): Date | null {
  const seconds = readNumber(expiresAt)
  if (seconds === null || seconds <= 0) return null
  return new Date(seconds * 1000)
}

// `granular_scopes[].target_ids` es la lista de assets que el cliente compartió
// con nuestra app para cada permiso. Sólo cuentan los de los dos permisos de
// WhatsApp: que un WABA aparezca bajo `business_management` dice que el usuario
// administra ese negocio, no que nos haya compartido esa cuenta de WhatsApp.
function extractSharedWabaIds(payload: Record<string, unknown>): string[] {
  const granular = payload.granular_scopes
  if (!Array.isArray(granular)) return []

  const ids = new Set<string>()
  for (const entry of granular) {
    if (!entry || typeof entry !== "object") continue
    const scope = (entry as Record<string, unknown>).scope
    if (
      typeof scope !== "string" ||
      !WHATSAPP_REQUIRED_SCOPES.includes(
        scope as (typeof WHATSAPP_REQUIRED_SCOPES)[number]
      )
    ) {
      continue
    }
    for (const id of readStringArray(
      (entry as Record<string, unknown>).target_ids
    )) {
      ids.add(id)
    }
  }
  return [...ids]
}

// Inspecciona el business token con el app token (`APP_ID|APP_SECRET`). Es la
// única llamada del módulo que no usa el token del cliente: `debug_token` pide
// el de la app, y por eso puede decir cosas que el propio token no confesaría.
export async function debugWhatsappToken(
  accessToken: string
): Promise<WhatsappTokenDebug> {
  const url = new URL(`${GRAPH}/debug_token`)
  url.searchParams.set("input_token", accessToken)
  url.searchParams.set("access_token", `${APP_ID}|${APP_SECRET}`)

  const { ok, status, data } = await graphRequest(
    { step: "assets", action: "token_exchange" },
    url
  )

  // La respuesta viene envuelta en `{"data": {…}}`.
  const payload =
    data.data && typeof data.data === "object"
      ? (data.data as Record<string, unknown>)
      : {}

  if (!ok || payload.is_valid !== true) {
    logMetaFailure({
      action: "token_exchange",
      reason: "token_exchange_failed",
      status,
      data,
    })
    throw new WhatsappApiError(
      "business token is not valid",
      "assets",
      "token_invalid",
      extractMetaErrorCode(data)
    )
  }

  return {
    expiresAt: resolveWhatsappTokenExpiry(payload.expires_at),
    scopes: readStringArray(payload.scopes),
    sharedWabaIds: extractSharedWabaIds(payload),
  }
}

// **Acá se comprueba la propiedad.** Es la comprobación que impide que un tenant
// reclame el WABA de otro: el `waba_id` que dijo el navegador tiene que estar
// entre los que el cliente compartió con nuestra app al autorizar.
//
// Falla cerrado si `granular_scopes` no viene. Meta documenta el campo en la
// referencia de `debug_token` pero no su uso para Embedded Signup, así que su
// ausencia significa «no pude confirmar la propiedad», y eso no es lo mismo que
// «está bien»: preferimos un onboarding que se corta y se investiga a uno que
// persiste un número que quizá no es del cliente.
export function assertWhatsappWabaShared(
  debug: WhatsappTokenDebug,
  wabaId: string
): void {
  const missing = WHATSAPP_REQUIRED_SCOPES.filter(
    (scope) => !debug.scopes.includes(scope)
  )
  if (missing.length > 0) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "configuration_failed",
      channel: "whatsapp",
      accountId: wabaId,
      errorMessage: `missing scopes: ${missing.join(",")}`,
    })
    throw new WhatsappApiError(
      "business token is missing the WhatsApp permissions",
      "assets",
      "missing_permissions"
    )
  }

  if (!debug.sharedWabaIds.includes(wabaId)) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "account_owned_by_other_tenant",
      channel: "whatsapp",
      accountId: wabaId,
      // Sin los ids compartidos: son datos de otro negocio y no hacen falta para
      // diagnosticar. Lo que importa es que el que llegó no estaba.
      errorMessage: "waba_id from the browser is not in granular_scopes",
    })
    throw new WhatsappApiError(
      "waba is not shared with this app",
      "assets",
      "waba_not_shared"
    )
  }
}

// ---------------------------------------------------------------------------
// Paso 3 — leer el WABA con el token del cliente
// ---------------------------------------------------------------------------

// Segunda confirmación, ahora contra el asset y no contra el token: si responde
// 200 el WABA está compartido de verdad. Que el `id` devuelto no coincida con el
// pedido no debería pasar nunca —y por eso mismo, si pasa, se aborta.
export async function fetchWhatsappBusinessAccount(
  accessToken: string,
  wabaId: string
): Promise<WhatsappBusinessAccount> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(wabaId)}`)
  url.searchParams.set("fields", "id,name")

  const { ok, status, data } = await graphRequest(
    { step: "assets", action: "oauth_callback", accountId: wabaId },
    url,
    { headers: bearer(accessToken) }
  )

  if (!ok || data.id !== wabaId) {
    logMetaFailure({
      action: "oauth_callback",
      reason: "profile_fetch_failed",
      accountId: wabaId,
      status,
      data,
    })
    throw new WhatsappApiError(
      "waba fetch failed",
      "assets",
      ok ? "waba_mismatch" : "waba_not_shared",
      extractMetaErrorCode(data)
    )
  }

  return { id: wabaId, name: readString(data.name) }
}

// ---------------------------------------------------------------------------
// Paso 4 — los números del WABA, fuente de verdad del `phone_number_id`
// ---------------------------------------------------------------------------

// `display_phone_number` llega formateado para leerlo (`+1 631-555-5555`) y la
// base guarda E.164. Se normaliza quedándose con los dígitos: el `+` se repone
// siempre porque todo número de Cloud API es internacional.
export function normalizeWhatsappPhoneE164(value: unknown): string | null {
  if (typeof value !== "string") return null
  const digits = value.replace(/\D/g, "")
  return digits.length > 0 ? `+${digits}` : null
}

export async function listWhatsappPhoneNumbers(
  accessToken: string,
  wabaId: string
): Promise<WhatsappPhoneNumber[]> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers`)
  // `is_on_biz_app` no viene en la proyección por defecto y es el campo que
  // distingue un número de Coexistence de uno normal: sin pedirlo, la rama de
  // Coexistence no tendría con qué decidir y caería siempre en «ninguno».
  url.searchParams.set(
    "fields",
    "id,display_phone_number,verified_name,is_on_biz_app"
  )

  const { ok, status, data } = await graphRequest(
    { step: "assets", action: "oauth_callback", accountId: wabaId },
    url,
    { headers: bearer(accessToken) }
  )

  if (!ok) {
    logMetaFailure({
      action: "oauth_callback",
      reason: "profile_fetch_failed",
      accountId: wabaId,
      status,
      data,
    })
    throw new WhatsappApiError(
      "phone numbers fetch failed",
      "assets",
      "waba_not_shared",
      extractMetaErrorCode(data)
    )
  }

  const rows = Array.isArray(data.data) ? data.data : []
  return rows.flatMap((row): WhatsappPhoneNumber[] => {
    if (!row || typeof row !== "object") return []
    const record = row as Record<string, unknown>
    const id = readString(record.id)
    if (!id) return []
    return [
      {
        id,
        displayPhoneNumber: readString(record.display_phone_number),
        phoneE164: normalizeWhatsappPhoneE164(record.display_phone_number),
        verifiedName: readString(record.verified_name),
        isOnBizApp: record.is_on_biz_app === true,
      },
    ]
  })
}

// Confronta la pista del navegador con la lista real. Que el `phone_number_id`
// del `postMessage` no esté en el WABA **no es un detalle**: significa que el
// número que se está intentando conectar no cuelga de la cuenta que el cliente
// compartió, y persistirlo sería dejar que un tenant se quede con el número de
// otro. Se corta en `assets`, igual que el WABA no compartido.
//
// **Los dos flujos resuelven distinto porque reciben distinto.**
//
// - *Estándar*: el `postMessage` trae el `phone_number_id` siempre. Sin pista es
//   un error, no una invitación a adivinar: caer en «si hay uno solo, ese»
//   convertiría un bug del launcher en una conexión silenciosa al número
//   equivocado.
// - *Coexistence*: el `postMessage` sólo trae `waba_id`, así que el número se
//   busca en la lista por `is_on_biz_app`. Adivinar sigue estando prohibido: si
//   hay más de un número vinculado a la app de WhatsApp Business se corta con
//   `coexistence_number_ambiguous` en vez de tomar el primero. Un WABA con dos
//   números en la app es raro pero posible, y elegir mal ahí es conectar el
//   número que el cliente no quería y pedirle el historial de otro negocio.
//
// Si en Coexistence *sí* llega pista, se usa —pero se sigue exigiendo que el
// número esté en la app: un número normal metido por esa rama no se registraría
// nunca y el canal quedaría conectado y mudo.
export function resolveWhatsappPhoneNumber(
  numbers: WhatsappPhoneNumber[],
  hintedPhoneNumberId: string | null | undefined,
  mode: WhatsappOnboardingMode = "standard"
): WhatsappPhoneNumber {
  if (mode === "coexistence") {
    return resolveCoexistencePhoneNumber(numbers, hintedPhoneNumberId)
  }

  if (!hintedPhoneNumberId) {
    throw new WhatsappApiError(
      "embedded signup did not report a phone_number_id",
      "assets",
      "missing_phone_number_id"
    )
  }

  const match = numbers.find((number) => number.id === hintedPhoneNumberId)
  if (!match) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "account_owned_by_other_tenant",
      channel: "whatsapp",
      accountId: hintedPhoneNumberId,
      errorMessage: "phone_number_id from the browser is not in the waba",
    })
    throw new WhatsappApiError(
      "phone number does not belong to the waba",
      "assets",
      "phone_not_in_waba"
    )
  }

  return match
}

function resolveCoexistencePhoneNumber(
  numbers: WhatsappPhoneNumber[],
  hintedPhoneNumberId: string | null | undefined
): WhatsappPhoneNumber {
  if (hintedPhoneNumberId) {
    const match = numbers.find((number) => number.id === hintedPhoneNumberId)
    if (!match) {
      log({
        entrypoint: "route",
        action: "oauth_callback",
        outcome: "failed",
        reason: "account_owned_by_other_tenant",
        channel: "whatsapp",
        accountId: hintedPhoneNumberId,
        errorMessage: "phone_number_id from the browser is not in the waba",
      })
      throw new WhatsappApiError(
        "phone number does not belong to the waba",
        "assets",
        "phone_not_in_waba"
      )
    }
    if (!match.isOnBizApp) {
      throw new WhatsappApiError(
        "phone number is not linked to the WhatsApp Business app",
        "assets",
        "coexistence_number_not_linked"
      )
    }
    return match
  }

  const linked = numbers.filter((number) => number.isOnBizApp)

  if (linked.length === 0) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "configuration_failed",
      channel: "whatsapp",
      errorMessage: "no phone number in the waba is on the business app",
    })
    throw new WhatsappApiError(
      "no coexistence number found in the waba",
      "assets",
      "coexistence_number_not_found"
    )
  }

  if (linked.length > 1) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "configuration_failed",
      channel: "whatsapp",
      // El conteo, no los ids: son números de teléfono del cliente.
      errorMessage: `waba has ${linked.length} numbers on the business app`,
    })
    throw new WhatsappApiError(
      "more than one coexistence number in the waba",
      "assets",
      "coexistence_number_ambiguous"
    )
  }

  return linked[0]!
}

// ---------------------------------------------------------------------------
// Paso 5 — suscribir la app al WABA
// ---------------------------------------------------------------------------

// Sin esto no llega **ningún** webhook de este cliente. Meta lo pone antes del
// registro y se respeta el orden: así la suscripción ya está activa cuando el
// número entra en servicio y no se pierden los primeros mensajes.
//
// El endpoint cuelga del **WABA**, no del número. Mandar el `phone_number_id`
// acá da un 400 que parece un fallo cualquiera y deja la cuenta muda (es el
// mismo error que documenta `lib/pages/channel-webhook.ts` para la baja).
//
// `subscribed_fields` sólo se manda en Coexistence, y con los tres campos que
// ese flujo necesita. En el estándar la llamada va pelada, que es lo que
// documenta Meta y lo que ya funciona: pasar una lista ahí sería estrechar la
// suscripción a lo que hoy sabemos leer y perder los campos que la app tiene
// habilitados en el dashboard.
export async function subscribeWhatsappWebhook(
  accessToken: string,
  wabaId: string,
  options: { subscribedFields?: readonly string[] } = {}
): Promise<void> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`)
  if (options.subscribedFields && options.subscribedFields.length > 0) {
    url.searchParams.set(
      "subscribed_fields",
      options.subscribedFields.join(",")
    )
  }

  const { ok, status, data } = await graphRequest(
    { step: "subscribe", action: "webhook_subscribe", accountId: wabaId },
    url,
    { method: "POST", headers: bearer(accessToken) }
  )

  if (!ok || data.success !== true) {
    logMetaFailure({
      action: "webhook_subscribe",
      reason: "subscription_failed",
      accountId: wabaId,
      status,
      data,
    })
    throw new WhatsappApiError(
      "waba subscription failed",
      "subscribe",
      "subscription_failed",
      extractMetaErrorCode(data)
    )
  }
}

// ---------------------------------------------------------------------------
// Paso 6a (sólo estándar) — registrar el número
// ---------------------------------------------------------------------------

// El PIN de `/register` es el de **verificación en dos pasos del número**, no un
// secreto nuestro ni algo que Meta devuelva. Hay dos casos y sólo dos:
//
// - el número no tiene 2FA → el PIN que mandamos **lo estamos creando** ahora, y
//   por eso lo generamos nosotros y lo devolvemos para que el llamador lo guarde
//   cifrado: sin él no hay re-registro posible y Meta no lo muestra nunca más;
// - el número ya tiene 2FA con otro PIN → Meta responde 133005 y el único camino
//   es que el cliente lo aporte (o lo desactive desde WhatsApp Manager).
//
// Se genera con el CSPRNG y con rechazo de muestras: 2^32 no es múltiplo de
// 1.000.000, así que un `% 1000000` a secas haría más probables los PIN bajos.
// Es un factor de autenticación del número del cliente; un `Math.random()` que
// se puede predecir desde otra pestaña no sirve.
export function generateWhatsappPin(): string {
  const MODULUS = 1_000_000
  const LIMIT = Math.floor(0xffffffff / MODULUS) * MODULUS
  const buffer = new Uint32Array(1)

  let value = 0
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0] ?? 0
  } while (value >= LIMIT)

  // Con `padStart`: un PIN es de seis dígitos, y `000123` es tan válido como
  // cualquier otro. Recortarlo a `123` lo haría rechazar.
  return String(value % MODULUS).padStart(6, "0")
}

// Qué es un PIN válido, **antes** de mandárselo a Meta. El `maxLength={6}` del
// input es decoración: la server action se puede invocar por POST directo, y
// hasta el usuario que escribe en el campo llega con lo que pegó del gestor de
// contraseñas —espacios alrededor, un guión en medio, o el «PIN» de otra cosa—.
// Sin esta puerta, todo eso sale como un `registration_failed` genérico que le
// dice al cliente que revise si el número está en uso en otra plataforma, que es
// exactamente lo que no pasó.
//
// Se quitan **todos** los espacios en blanco, no solo los de los extremos: un
// PIN copiado de un SMS o de un gestor llega tan a menudo como `04 27 13` como
// pegado, y rechazar eso sería inventarse una regla que Meta no tiene. Cualquier
// otro carácter sí es un rechazo: el PIN de Cloud API son seis dígitos, ni cinco
// ni siete, y `042713` no es lo mismo que `42713`.
export type WhatsappPinInput =
  | { ok: true; value: string }
  | { ok: false; message: string }

export function normalizeWhatsappPin(value: string): WhatsappPinInput {
  const digits = value.replace(/\s+/g, "")
  if (!/^\d{6}$/.test(digits)) {
    return {
      ok: false,
      message:
        "El PIN de verificación en dos pasos son 6 dígitos, sin letras ni símbolos. Revísalo y vuelve a lanzar la conexión.",
    }
  }

  return { ok: true, value: digits }
}

export async function registerWhatsappPhoneNumber(
  accessToken: string,
  phoneNumberId: string,
  pin: string
): Promise<void> {
  const { ok, status, data } = await graphRequest(
    { step: "register", action: "account_connect", accountId: phoneNumberId },
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}/register`,
    {
      method: "POST",
      headers: { ...bearer(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    }
  )

  if (!ok || data.success !== true) {
    const code = extractMetaErrorCode(data)
    logMetaFailure({
      action: "account_connect",
      reason: "meta_rejected",
      accountId: phoneNumberId,
      status,
      data,
    })
    // 133005 es el único desenlace del registro con una salida clara del lado
    // del cliente, y está documentado verbatim. Los demás códigos van con su
    // número al log para que la pantalla muestre el mensaje genérico y soporte
    // tenga con qué buscar.
    throw new WhatsappApiError(
      code === WHATSAPP_PIN_INCORRECT_CODE
        ? "phone number already has a two-step verification pin"
        : "phone number registration failed",
      "register",
      code === WHATSAPP_PIN_INCORRECT_CODE
        ? "pin_required"
        : "registration_failed",
      code
    )
  }
}

// ---------------------------------------------------------------------------
// Paso 6b (sólo Coexistence) — pedir el history sync
// ---------------------------------------------------------------------------

// **El historial no llega solo: hay que pedirlo.** Es una llamada a la SMB App
// Data API sobre el número, con `sync_type: "history"`, y es la que arranca el
// reloj: desde que responde hay **24 horas** para terminar de sincronizar, y si
// se pasan, Meta obliga a offboardear el número y rehacer el Embedded Signup.
//
// Por eso esta llamada es el último paso del onboarding y no el primero de otra
// cosa: pedirlo antes de tener la suscripción a `history` sería tirar los chunks
// que llegaran mientras tanto, y el sync no se pide dos veces.
//
// Cuántos webhooks `history` llegan después lo decide el negocio al vincular:
// «zero, one, or more». Un import vacío es un desenlace válido, no un fallo —de
// ahí que esta función devuelva sólo si la *solicitud* salió—.
export async function requestWhatsappHistorySync(
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  const { ok, status, data } = await graphRequest(
    {
      step: "sync_request",
      action: "account_connect",
      accountId: phoneNumberId,
    },
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}/smb_app_data`,
    {
      method: "POST",
      headers: { ...bearer(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        sync_type: "history",
      }),
    }
  )

  if (!ok || data.success !== true) {
    logMetaFailure({
      action: "account_connect",
      reason: "meta_rejected",
      accountId: phoneNumberId,
      status,
      data,
    })
    throw new WhatsappApiError(
      "history sync request failed",
      "sync_request",
      "history_sync_failed",
      extractMetaErrorCode(data)
    )
  }
}

// ---------------------------------------------------------------------------
// Media entrante
// ---------------------------------------------------------------------------

// Bajar un archivo son **dos llamadas**, y las dos van autenticadas:
//
// 1. `GET /{media_id}` devuelve un sobre JSON con la URL real, el `mime_type` y
//    el `file_size`. Esa URL **vive 5 minutos** y no cuelga del Graph: apunta al
//    CDN de Meta.
// 2. `GET {url}` con el mismo Bearer trae los bytes. Sin la cabecera responde
//    401 aunque la URL sea correcta y esté fresca.
//
// **La URL temporal no se persiste ni se registra nunca.** Es una credencial de
// lectura sobre contenido del cliente con cinco minutos de vida: guardarla en la
// base sería dejar un enlace que caduca en una fila que no caduca, y escribirla
// en un log sería publicarla. Por eso `fetchWhatsappMediaMetadata` la devuelve
// para usarla en el acto y nada más, y por eso ningún `log()` de esta sección
// lleva la URL.
export type WhatsappMediaMetadata = {
  id: string
  // La URL temporal del CDN. **Cinco minutos, y ni al log ni a la base.**
  url: string
  mimeType: string | null
  fileSize: number | null
  sha256: string | null
}

export async function fetchWhatsappMediaMetadata(
  accessToken: string,
  mediaId: string,
  options: { phoneNumberId?: string } = {}
): Promise<WhatsappMediaMetadata> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(mediaId)}`)
  // `phone_number_id` es opcional y Meta lo recomienda: con él, un media id de
  // otro número responde 404 en vez de resolver. Es la comprobación de propiedad
  // del lado de Meta, y sale gratis.
  if (options.phoneNumberId) {
    url.searchParams.set("phone_number_id", options.phoneNumberId)
  }

  const { ok, status, data } = await graphRequest(
    { step: "persist", action: "inbound_ingest", accountId: mediaId },
    url,
    { headers: bearer(accessToken) }
  )

  const mediaUrl = readString(data.url)
  if (!ok || !mediaUrl) {
    logMetaFailure({
      action: "inbound_ingest",
      reason: "meta_rejected",
      accountId: mediaId,
      status,
      data,
    })
    // El id vive 7 días si vino del webhook y 14 desde el historial: un 404 acá
    // es casi siempre «venció», no «no existe».
    throw new WhatsappApiError(
      "media metadata fetch failed",
      "persist",
      "media_not_found",
      extractMetaErrorCode(data)
    )
  }

  return {
    id: readString(data.id) ?? mediaId,
    url: mediaUrl,
    mimeType: readString(data.mime_type),
    fileSize: readNumber(data.file_size),
    sha256: readString(data.sha256),
  }
}

export type WhatsappMediaStream = {
  mediaId: string
  mimeType: string | null
  fileSize: number | null
  sha256: string | null
  // El cuerpo sin consumir, para escribirlo derecho a R2 sin cargar 100 MB en
  // memoria. `null` sólo si el runtime no expone el stream.
  body: ReadableStream<Uint8Array> | null
}

export type WhatsappMediaDownload = Omit<WhatsappMediaStream, "body"> & {
  bytes: ArrayBuffer
}

// Las dos llamadas seguidas, devolviendo el cuerpo **sin consumir**. Es la
// versión que usa el job de descarga: valida el MIME y el tamaño con la
// metadata y hace `pipe` a R2 sin materializar el archivo.
export async function openWhatsappMediaStream(
  accessToken: string,
  mediaId: string,
  options: { phoneNumberId?: string } = {}
): Promise<WhatsappMediaStream> {
  const metadata = await fetchWhatsappMediaMetadata(
    accessToken,
    mediaId,
    options
  )

  let response: Response
  try {
    response = await fetch(metadata.url, {
      headers: {
        ...bearer(accessToken),
        // Meta rechaza la descarga sin `User-Agent`: el CDN devuelve un 400 que
        // no dice por qué. Es un requisito documentado del endpoint de media, no
        // una cortesía.
        "User-Agent": "Resender/1 (+https://resender.app)",
      },
      signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    log({
      entrypoint: "queue",
      action: "inbound_ingest",
      outcome: "failed",
      reason: "network_error",
      channel: "whatsapp",
      accountId: mediaId,
      errorMessage: describeError(error),
    })
    throw new WhatsappApiError(
      "media download failed",
      "persist",
      "network_error"
    )
  }

  if (!response.ok) {
    // **Sin el body y sin la URL**: el body son bytes del contenido del cliente
    // y la URL es la credencial temporal. Sólo el status, que es lo que
    // distingue «venció la URL» (401/403) de «Meta se cayó» (5xx).
    log({
      entrypoint: "queue",
      action: "inbound_ingest",
      outcome: "failed",
      reason: "http_error",
      channel: "whatsapp",
      accountId: mediaId,
      status: response.status,
    })
    throw new WhatsappApiError(
      "media download returned a non-2xx",
      "persist",
      "media_download_failed"
    )
  }

  return {
    mediaId: metadata.id,
    // El `content-type` de la descarga manda sobre el del sobre cuando difieren:
    // es el que describe los bytes que realmente llegaron.
    mimeType:
      readString(response.headers.get("content-type")) ?? metadata.mimeType,
    fileSize:
      readNumber(response.headers.get("content-length")) ?? metadata.fileSize,
    sha256: metadata.sha256,
    body: response.body,
  }
}

// La misma descarga, ya en memoria. Para todo lo que no sea el job de R2 —tests,
// media chica, reenvíos— y para cuando hay que mirar los bytes antes de decidir.
export async function downloadWhatsappMedia(
  accessToken: string,
  mediaId: string,
  options: { phoneNumberId?: string } = {}
): Promise<WhatsappMediaDownload> {
  const { body, ...rest } = await openWhatsappMediaStream(
    accessToken,
    mediaId,
    options
  )

  const bytes = body
    ? await new Response(body).arrayBuffer()
    : new ArrayBuffer(0)

  return { ...rest, bytes, fileSize: rest.fileSize ?? bytes.byteLength }
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

// Los cuatro tipos con adjunto que Cloud API acepta por `link`. Sticker queda
// fuera a propósito: exige WebP con restricciones de tamaño que el cliente no
// puede cumplir por accidente, y aceptarlo sería prometer envíos que Meta
// rechaza.
export type WhatsappOutboundMediaType = "image" | "video" | "audio" | "document"

export type WhatsappOutboundMedia = {
  type: WhatsappOutboundMediaType
  // **URL pública del cliente.** Resender nunca sube media saliente: Meta
  // descarga el archivo desde acá y lo cachea 10 minutos, igual que en
  // Messenger. Si el origen del cliente está caído en ese instante, el mensaje
  // falla —y eso hay que decirlo en la doc, no esconderlo—.
  link: string
  // `audio` no admite caption; `document` es el único que admite `filename`.
  caption?: string
  filename?: string
}

export type WhatsappOutboundMessage =
  | { text: string; previewUrl?: boolean }
  | { media: WhatsappOutboundMedia }

// El sobre de Cloud API. `messaging_product` es obligatorio en **todas** las
// llamadas de mensajería —no es el mismo campo que el `messaging_type` de
// Messenger, que acá no existe— y `recipient_type: "individual"` va explícito
// aunque sea el default: es la diferencia con los envíos a grupo, que este
// producto no hace.
export function buildWhatsappMessagePayload(
  to: string,
  message: WhatsappOutboundMessage
): Record<string, unknown> {
  const envelope = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
  }

  if ("text" in message) {
    return {
      ...envelope,
      type: "text",
      // `preview_url` decide si WhatsApp renderiza la tarjeta del primer enlace
      // del texto. Por defecto no: un preview que se genera solo cambia cómo se
      // ve el mensaje que el tenant escribió.
      text: { body: message.text, preview_url: message.previewUrl === true },
    }
  }

  const { type, link, caption, filename } = message.media
  // La clave del objeto **es** el tipo: `{ type: "image", image: { link } }`.
  // Mandar `attachment` —la forma de Messenger— da un 400 genérico.
  const media: Record<string, unknown> = { link }
  // `audio` no lleva caption y `filename` sólo lo lee `document`: mandarlos
  // igual hace que Meta rechace el mensaje entero en vez de ignorar el campo.
  if (caption && type !== "audio") media.caption = caption
  if (filename && type === "document") media.filename = filename

  return { ...envelope, type, [type]: media }
}

// El envío. Comparte `MetaSendResult` con Messenger e Instagram —el sobre de
// error de Graph es el mismo y las rutas devuelven la misma forma al cliente—
// pero la request difiere en tres cosas que no son cosméticas:
//
// 1. **El token va en `Authorization: Bearer`**, no como query param. La forma
//    con `?access_token=` es la de la Send API de Messenger; acá deja el token
//    dentro de cualquier URL que se loguee.
// 2. **El path cuelga del `phone_number_id`**, no de la Página ni de `me`.
// 3. **`messaging_product: "whatsapp"` es obligatorio** y no hay
//    `messaging_type`: ese campo es de Messenger.
export async function sendWhatsappMessage(input: {
  accessToken: string
  phoneNumberId: string
  to: string
  message: WhatsappOutboundMessage
}): Promise<MetaSendResult> {
  try {
    const response = await fetch(
      `${GRAPH}/${encodeURIComponent(input.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          ...bearer(input.accessToken),
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
        body: JSON.stringify(
          buildWhatsappMessagePayload(input.to, input.message)
        ),
      }
    )

    const data = await response.json().catch(() => null)
    const metaError = extractMetaErrorMessage(data)
    // `reason` y `code` salen de la misma consulta al catálogo para que no
    // puedan desincronizarse, igual que en `meta-send.ts`.
    const described = response.ok ? null : explainWhatsappError(data)
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok
        ? null
        : (metaError ?? `Meta returned HTTP ${response.status}`),
      reason: described?.message ?? null,
      code: described?.code ?? null,
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: error instanceof Error ? error.message : "Meta request failed",
      reason:
        "Could not reach WhatsApp's Cloud API (network error or timeout). Retry shortly.",
      code: null,
    }
  }
}

// Cloud API **no** devuelve `message_id` como Messenger: devuelve
// `{"messages":[{"id":"wamid…"}]}`. Reusar `extractMetaMessageId` acá devolvería
// `null` siempre, y el mensaje quedaría persistido sin el id con el que después
// llegan sus `statuses` —que es el id que cierra el círculo entre lo que
// mandamos y lo que Meta dice que pasó con eso—.
export function extractWhatsappMessageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const messages = (data as Record<string, unknown>).messages
  if (!Array.isArray(messages)) return null
  const first = messages[0]
  if (!first || typeof first !== "object") return null
  return readString((first as Record<string, unknown>).id)
}

// ---------------------------------------------------------------------------
// Catálogo de traducción
// ---------------------------------------------------------------------------

// **Catálogo propio, no una reutilización del de Messenger.** Es la misma
// decisión que tomó `instagram-send.ts` y por el mismo motivo: los códigos del
// sobre de Graph coinciden en parte, pero *lo que el usuario tiene que hacer es
// distinto*, y esa acción es el punto entero de traducir un error. Decirle
// «reconectá la Página» a quien conectó un número de WhatsApp lo manda a buscar
// algo que no tiene; y la ventana de 24 horas, que en Messenger es un `10` con
// subcódigo, acá es un código propio (131047) con un desenlace distinto: en
// WhatsApp se puede reabrir con una plantilla, que es producto que todavía no
// vendemos.
//
// Los tres motivos que **no** dependen de qué se estaba enviando —token, rate
// limit y bloqueo por política— se exportan sueltos, como en Instagram, para que
// el catálogo del webhook y el del onboarding los reusen en vez de recopiarlos.
export const WHATSAPP_TOKEN_EXPIRED_REASON =
  "The WhatsApp business token expired or was revoked. There is no refresh for Embedded Signup tokens: reconnect the number in Resender."
export const WHATSAPP_RATE_LIMIT_REASON =
  "Meta rate limit reached for this app or number. Retry later with backoff."
export const WHATSAPP_BLOCKED_REASON =
  "The WhatsApp Business account is temporarily blocked from sending due to a policy violation on Meta's side."
export const WHATSAPP_WINDOW_CLOSED_REASON =
  "WhatsApp's 24-hour customer service window is closed: this contact hasn't messaged the number in the last 24 hours, so Meta rejects free-form messages until they write again."
export const WHATSAPP_PIN_INCORRECT_REASON =
  "This number already has two-step verification with a different PIN. Enter the current PIN, or turn two-step verification off from WhatsApp Manager and try again."

// Devuelve `{ code, message }` o `null`. **`null` significa «no hay traducción,
// a propósito»**: el mensaje crudo de Meta viaja igual en `error`, y traducir de
// más —un `100` genérico, un `131000`— sería inventarle al cliente una causa que
// no sabemos. El `code` es el identificador estable que la API pública expone, y
// es `null` en todo lo que no sea un fallo de adjunto: los demás casos ya se
// distinguen por el mensaje.
export function explainWhatsappError(
  data: unknown
): { code: string | null; message: string } | null {
  const code = extractMetaErrorCode(data)
  if (code === null) return null

  if (code === 190) {
    return { code: null, message: WHATSAPP_TOKEN_EXPIRED_REASON }
  }

  // 131047 = "Re-engagement message". Es **el** error del canal: la ventana de
  // 24 horas se cerró. No comparte código con Messenger ni con Instagram, así
  // que un catálogo compartido lo habría tirado a la rama genérica de permisos.
  if (code === 131047) {
    return { code: null, message: WHATSAPP_WINDOW_CLOSED_REASON }
  }

  // 131026 = "Message undeliverable". Es distinto de la ventana cerrada: el
  // número destino no tiene WhatsApp, o no puede recibir del negocio.
  if (code === 131026) {
    return {
      code: null,
      message:
        "WhatsApp couldn't deliver this message: the recipient may not have WhatsApp, may have an outdated app, or may be unable to receive messages from this business.",
    }
  }

  // 131031 = cuenta bloqueada o inhabilitada. Termina el canal hasta que el
  // cliente lo resuelva en WhatsApp Manager: no es reintentable.
  if (code === 131031) {
    return {
      code: null,
      message:
        "The WhatsApp Business account is locked or disabled. Check WhatsApp Manager for the account status: sends stay rejected until Meta lifts it.",
    }
  }

  // 131042 = problema de método de pago del negocio. Se ve como un fallo de
  // envío y no lo es: la línea de crédito del WABA está sin resolver.
  if (code === 131042) {
    return {
      code: null,
      message:
        "The WhatsApp Business account has a billing problem: add or fix the payment method on the WABA in Meta Business Manager.",
    }
  }

  // 131053 = Meta no pudo **subir** la media, que en un envío por `link`
  // significa que no pudo descargarla del origen del cliente. Es el gemelo del
  // 100/2018047 de Messenger y lleva el mismo `code` estable, porque la acción
  // del cliente es idéntica.
  if (code === 131053) {
    return {
      code: "attachment_fetch_failed",
      message:
        "Meta couldn't download the media from its URL. Make sure the URL is publicly reachable over https, without auth and without broken redirects, and that the file type and size are supported.",
    }
  }

  // 131052 = Meta no pudo **bajar** la media que mandó el usuario. Es de la
  // entrada, no de la salida: el adjunto entrante se queda sin archivo.
  if (code === 131052) {
    return {
      code: "media_download_failed",
      message:
        "Meta couldn't retrieve the media the contact sent. The media id may have expired: incoming media ids last 7 days.",
    }
  }

  // 130429 es el techo de throughput de Cloud API y los otros cuatro son los
  // límites de app de Graph. Distinta capa, misma acción: esperar y reintentar.
  if (
    code === 130429 ||
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613
  ) {
    return { code: null, message: WHATSAPP_RATE_LIMIT_REASON }
  }

  if (code === 368) {
    return { code: null, message: WHATSAPP_BLOCKED_REASON }
  }

  // 133005 no es de envío sino de `/register`, y está en el mismo catálogo a
  // propósito: la pantalla de conexión traduce con la misma función que la de
  // envío, y tener dos catálogos por canal fue justo lo que este archivo evita.
  if (code === WHATSAPP_PIN_INCORRECT_CODE) {
    return { code: null, message: WHATSAPP_PIN_INCORRECT_REASON }
  }

  return null
}

export function isWhatsappExpiredTokenError(data: unknown): boolean {
  return extractMetaErrorCode(data) === 190
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

// **El onboarding está partido en dos mitades, y el corte no es estético.**
//
// Los cuatro primeros pasos —canje, `debug_token`, lectura del WABA y lista de
// números— son de solo lectura: si algo falla ahí, en Meta no cambió nada y el
// cliente puede volver a lanzar el flujo sin consecuencias. Los últimos
// —suscribir, registrar, pedir el historial— son **irreversibles**: `/register`
// activa la verificación en dos pasos del número con el PIN que le mandamos y no
// hay endpoint que la deshaga (solo el propio cliente, desde WhatsApp Manager), y
// la solicitud de history sync arranca un reloj de 24 horas que no se reinicia.
//
// Entre las dos mitades hace falta un veredicto que este módulo no puede dar:
// si el `phone_number_id` ya pertenece a otro tenant de Resender. Esa pregunta
// es de la base de datos, no de Graph —Meta no sabe nada de nuestros tenants—, y
// hasta ahora se contestaba dentro del escritor, es decir **después** de haber
// registrado. El precio era doble: el PIN del dueño legítimo quedaba obsoleto
// (se lo acabábamos de pisar con el del intruso) y el intruso se llevaba un
// número registrado a su nombre en Meta.
//
// Por eso dos funciones y no un hook: un callback que corre «en el medio» ata al
// llamador a la forma interna de este módulo y esconde el punto de no retorno
// justo donde hay que verlo. Dos mitades lo ponen en el sitio de la llamada —el
// llamador decide entre `beginWhatsappSignup` y `finishWhatsappSignup` con la
// respuesta de la base en la mano— y hacen que el orden sea legible en la server
// action, que es donde alguien va a ir a buscarlo.

// Lo que Graph ya confirmó, antes de tocar nada. El `phone` sale de
// `/{waba_id}/phone_numbers`, no del `postMessage`: es el identificador con el
// que se puede consultar la propiedad sin arriesgarse a mirar la fila
// equivocada. El `mode` viaja con el target porque es lo que decide la segunda
// mitad, y dejarlo fuera permitiría empezar en Coexistence y terminar
// registrando.
export type WhatsappSignupTarget = {
  accessToken: string
  tokenExpiresAt: Date | null
  wabaId: string
  wabaName: string | null
  phone: WhatsappPhoneNumber
  mode: WhatsappOnboardingMode
}

// Mitad reversible: canje, validación de token y propiedad del WABA, lectura de
// la cuenta y de sus números. No suscribe, no registra y no pide historial.
export async function beginWhatsappSignup(input: {
  code: string
  hint: WhatsappSignupHint
  mode?: WhatsappOnboardingMode
}): Promise<WhatsappSignupTarget> {
  const mode = input.mode ?? "standard"
  const accessToken = await exchangeWhatsappCode(input.code)

  const debug = await debugWhatsappToken(accessToken)
  assertWhatsappWabaShared(debug, input.hint.wabaId)

  const account = await fetchWhatsappBusinessAccount(
    accessToken,
    input.hint.wabaId
  )
  const numbers = await listWhatsappPhoneNumbers(accessToken, input.hint.wabaId)
  const phone = resolveWhatsappPhoneNumber(
    numbers,
    input.hint.phoneNumberId,
    mode
  )

  return {
    accessToken,
    tokenExpiresAt: debug.expiresAt,
    wabaId: account.id,
    wabaName: account.name,
    phone,
    mode,
  }
}

// Mitad irreversible. Devuelve todo lo que hay que persistir; **no persiste
// nada** —eso es del llamador, que es quien tiene el tenant y la clave de
// cifrado, y quien reporta el paso `persist` si falla su parte—.
//
// Las dos ramas se separan acá y en ningún otro sitio:
//
// - **estándar**: suscribe pelado y registra el número con un PIN;
// - **Coexistence**: suscribe **con los tres campos** y pide el history sync.
//   **No llama a `/register`**, y eso no es una omisión: registrar un número que
//   ya opera desde la app de WhatsApp Business lo desvincula de la app, que es
//   exactamente lo que Coexistence existe para no hacer.
export async function finishWhatsappSignup(
  target: WhatsappSignupTarget,
  input: {
    // El PIN actual del número: el que el cliente aportó tras un 133005, o el
    // que ya guardamos de un registro anterior. Sin él se genera uno nuevo, que
    // es el caso normal de un número sin verificación en dos pasos. Se ignora en
    // Coexistence, que no registra.
    pin?: string
  } = {}
): Promise<WhatsappSignupResult> {
  const base = {
    accessToken: target.accessToken,
    tokenExpiresAt: target.tokenExpiresAt,
    wabaId: target.wabaId,
    wabaName: target.wabaName,
    phoneNumberId: target.phone.id,
    phoneE164: target.phone.phoneE164,
    verifiedName: target.phone.verifiedName,
    onboardingMode: target.mode,
  }

  if (target.mode === "coexistence") {
    await subscribeWhatsappWebhook(target.accessToken, target.wabaId, {
      subscribedFields: WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS,
    })
    await requestWhatsappHistorySync(target.accessToken, target.phone.id)

    return {
      ...base,
      pin: null,
      pinGenerated: false,
      historySyncRequested: true,
    }
  }

  await subscribeWhatsappWebhook(target.accessToken, target.wabaId)

  const pinGenerated = !input.pin
  const pin = input.pin ?? generateWhatsappPin()
  await registerWhatsappPhoneNumber(target.accessToken, target.phone.id, pin)

  return { ...base, pin, pinGenerated, historySyncRequested: null }
}

// Las dos mitades seguidas, que es el orden que documenta Meta para Tech
// Providers. Es la definición ejecutable de ese orden —los tests del módulo la
// usan para fijarlo—, pero el onboarding real llama a las dos por separado
// porque necesita meter la comprobación de propiedad en el medio.
export async function completeWhatsappSignup(input: {
  code: string
  hint: WhatsappSignupHint
  mode?: WhatsappOnboardingMode
  pin?: string
}): Promise<WhatsappSignupResult> {
  const target = await beginWhatsappSignup(input)
  return finishWhatsappSignup(target, { pin: input.pin })
}
