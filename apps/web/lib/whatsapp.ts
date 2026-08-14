import { META_GRAPH_VERSION } from "@/lib/meta-graph"
import type { LogAction, LogReason } from "@/lib/observability/logger"
import { describeError, log } from "@/lib/observability/logger"
import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
  extractMetaErrorSubcode,
} from "@/lib/outbound/meta-send"

// Cliente de **WhatsApp Cloud API** para el onboarding por Embedded Signup
// (flujo estándar, como Tech Provider y sin BSP).
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
// Este slice implementa **sólo el flujo estándar**. Coexistence (números que ya
// operan en la app de WhatsApp Business) comparte el intercambio, la validación
// de assets y la suscripción, pero omite el registro y resuelve el número desde
// la lista porque su `postMessage` no trae `phone_number_id`. Los tipos están
// hechos para que eso entre después sin reescribir: por eso el hint tiene el
// `phoneNumberId` opcional y el resultado lleva `onboardingMode`.

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID!
const APP_SECRET = process.env.META_APP_SECRET!

// Cloud API vive en el Graph de Facebook, no en un host propio como Instagram.
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`

// Los dos permisos del Configuration ID de Embedded Signup: `management` para
// leer el WABA y suscribir la app, `messaging` para enviar y recibir. Sin los
// dos el onboarding termina en una conexión que se conecta y no habla.
export const WHATSAPP_REQUIRED_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const

// "Two-step verification PIN incorrect." Es el único subcódigo del registro que
// tiene una acción clara del lado del cliente, y está documentado verbatim en la
// tabla de errores de Cloud API. El resto de los códigos del canje **no están
// documentados** por Meta, así que este módulo no los adivina: mapea por
// ausencia del campo esperado en la respuesta y deja el código crudo en el log
// para descubrirlos empíricamente.
export const WHATSAPP_PIN_INCORRECT_CODE = 133005

// Los pasos del onboarding, en el orden en que ocurren. `persist` no lo ejecuta
// este módulo —la persistencia cifrada es de la ruta que lo llama—, pero está en
// la unión para que el callback pueda reportar un único `step` sin inventarse un
// valor cuando lo que falla es la escritura.
export type WhatsappOnboardingStep =
  | "exchange"
  | "assets"
  | "register"
  | "subscribe"
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
  pin: string
  // `false` cuando el PIN lo aportó el cliente (número que ya tenía 2FA). Sirve
  // para no mostrarle en pantalla un PIN que ya conoce.
  pinGenerated: boolean
  onboardingMode: WhatsappOnboardingMode
}

// ---------------------------------------------------------------------------
// Helpers de transporte
// ---------------------------------------------------------------------------

// **Las llamadas que usan el token del cliente lo mandan en `Authorization`, no
// en el query ni en el body.** Son cuatro —el WABA, sus números, la suscripción
// y el registro—. El registro obliga (su body es JSON, así que no hay dónde
// meter un `access_token=`), y usar el mismo mecanismo en las cuatro evita el
// caso que el logger tiene que limpiar a mano en los otros canales: una URL con
// el token en el query que termina en el mensaje de un error.
//
// **Las otras dos llevan credenciales en el querystring, y no hay alternativa:**
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
// Lo que sí se sostiene en las seis, y es lo que de verdad protege: este módulo
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
async function graphRequest(
  call: { step: WhatsappOnboardingStep; action: LogAction; accountId?: string },
  input: URL | string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  let response: Response
  try {
    response = await fetch(input, init)
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
  const seconds =
    typeof expiresAt === "number"
      ? expiresAt
      : typeof expiresAt === "string"
        ? Number(expiresAt)
        : Number.NaN

  if (!Number.isFinite(seconds) || seconds <= 0) return null
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
// Coexistence llegará sin pista —su `postMessage` sólo trae `waba_id`— y tendrá
// que resolver el número desde esta misma lista tras comprobar `is_on_biz_app`.
// Esa rama se deja explícitamente sin implementar en vez de caer en «si hay uno
// solo, ese»: en el flujo estándar la pista viene siempre, y adivinarla sería
// convertir un bug del launcher en una conexión silenciosa al número equivocado.
export function resolveWhatsappPhoneNumber(
  numbers: WhatsappPhoneNumber[],
  hintedPhoneNumberId: string | null | undefined
): WhatsappPhoneNumber {
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
export async function subscribeWhatsappWebhook(
  accessToken: string,
  wabaId: string
): Promise<void> {
  const { ok, status, data } = await graphRequest(
    { step: "subscribe", action: "webhook_subscribe", accountId: wabaId },
    `${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`,
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
// Paso 6 — registrar el número
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
// Orquestación
// ---------------------------------------------------------------------------

// **El onboarding está partido en dos mitades, y el corte no es estético.**
//
// Los cuatro primeros pasos —canje, `debug_token`, lectura del WABA y lista de
// números— son de solo lectura: si algo falla ahí, en Meta no cambió nada y el
// cliente puede volver a lanzar el flujo sin consecuencias. Los dos últimos
// —suscribir y registrar— son **irreversibles**: `/register` activa la
// verificación en dos pasos del número con el PIN que le mandamos, y no hay
// endpoint que la deshaga (solo el propio cliente, desde WhatsApp Manager).
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
// equivocada.
export type WhatsappSignupTarget = {
  accessToken: string
  tokenExpiresAt: Date | null
  wabaId: string
  wabaName: string | null
  phone: WhatsappPhoneNumber
}

// Mitad reversible: canje, validación de token y propiedad del WABA, lectura de
// la cuenta y de sus números. No suscribe ni registra.
export async function beginWhatsappSignup(input: {
  code: string
  hint: WhatsappSignupHint
}): Promise<WhatsappSignupTarget> {
  const accessToken = await exchangeWhatsappCode(input.code)

  const debug = await debugWhatsappToken(accessToken)
  assertWhatsappWabaShared(debug, input.hint.wabaId)

  const account = await fetchWhatsappBusinessAccount(
    accessToken,
    input.hint.wabaId
  )
  const numbers = await listWhatsappPhoneNumbers(accessToken, input.hint.wabaId)
  const phone = resolveWhatsappPhoneNumber(numbers, input.hint.phoneNumberId)

  return {
    accessToken,
    tokenExpiresAt: debug.expiresAt,
    wabaId: account.id,
    wabaName: account.name,
    phone,
  }
}

// Mitad irreversible: suscribe el WABA y registra el número. Devuelve todo lo
// que hay que persistir; **no persiste nada** —eso es del llamador, que es quien
// tiene el tenant y la clave de cifrado, y quien reporta el paso `persist` si
// falla su parte—.
export async function finishWhatsappSignup(
  target: WhatsappSignupTarget,
  input: {
    // El PIN actual del número: el que el cliente aportó tras un 133005, o el
    // que ya guardamos de un registro anterior. Sin él se genera uno nuevo, que
    // es el caso normal de un número sin verificación en dos pasos.
    pin?: string
  } = {}
): Promise<WhatsappSignupResult> {
  await subscribeWhatsappWebhook(target.accessToken, target.wabaId)

  const pinGenerated = !input.pin
  const pin = input.pin ?? generateWhatsappPin()
  await registerWhatsappPhoneNumber(target.accessToken, target.phone.id, pin)

  return {
    accessToken: target.accessToken,
    tokenExpiresAt: target.tokenExpiresAt,
    wabaId: target.wabaId,
    wabaName: target.wabaName,
    phoneNumberId: target.phone.id,
    phoneE164: target.phone.phoneE164,
    verifiedName: target.phone.verifiedName,
    pin,
    pinGenerated,
    onboardingMode: "standard",
  }
}

// Las dos mitades seguidas, que es el orden que documenta Meta para Tech
// Providers. Es la definición ejecutable de ese orden —los tests del módulo la
// usan para fijarlo—, pero el onboarding real llama a las dos por separado
// porque necesita meter la comprobación de propiedad en el medio.
export async function completeWhatsappSignup(input: {
  code: string
  hint: WhatsappSignupHint
  pin?: string
}): Promise<WhatsappSignupResult> {
  const target = await beginWhatsappSignup(input)
  return finishWhatsappSignup(target, { pin: input.pin })
}
