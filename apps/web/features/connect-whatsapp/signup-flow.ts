import type { LogReason } from "@/lib/observability/logger"
import type { AppDict } from "@/content/i18n/app"
import {
  WhatsappApiError,
  WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS,
  type WhatsappOnboardingMode,
  type WhatsappOnboardingStep,
  type WhatsappSignupResult,
  type WhatsappSignupTarget,
} from "@/lib/meta/whatsapp-client"
import type { HistorySyncStatus } from "@/lib/pages/connection-display"
import {
  PageOwnershipError,
  type ConnectedPageRecord,
  type WhatsappNumberInput,
  type WhatsappNumberOwnership,
  type WhatsappPinOrigin,
} from "@/lib/pages/page-registry"
import { checkAccountSlotAvailable } from "@/lib/pages/page-selection"

// El cierre del Embedded Signup, del lado del servidor y **sin Next adentro**.
//
// Todo lo que decide algo vive acá: el orden de los dos flujos, dónde va la
// comprobación de propiedad, de quién es el PIN, qué se persiste y qué se
// encola. La ruta que lo llama se queda con lo que este módulo no puede
// probar —sesión, cookies, redirecciones— y con el log.
//
// La razón es la regla del repo: los `.tsx` y las rutas no se testean, y la
// diferencia más cara de este slice —**el flujo A registra el número con
// `/register` y el B no lo toca jamás**— es una rama de tres líneas que en una
// ruta quedaría sin red. Registrar un número de Coexistence lo desvincula de la
// app de WhatsApp Business y eso no se deshace desde acá.

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------

// Se inyectan en vez de importarse para que el test pueda observar **qué se
// llamó y en qué orden**, que es justamente lo que hay que fijar. Los tipos son
// los de los módulos reales, así que un cambio de firma en el cliente de Meta
// rompe la compilación acá y no en producción.
export type WhatsappSignupDeps = {
  /** Mitad reversible: canje, `debug_token`, WABA y lista de números. */
  begin(input: {
    code: string
    hint: { wabaId: string; phoneNumberId?: string | null }
    mode?: WhatsappOnboardingMode
  }): Promise<WhatsappSignupTarget>
  /**
   * Mitad irreversible del **flujo estándar**: suscribe el WABA y registra el
   * número con `/register`. Es `finishWhatsappSignup` del cliente.
   */
  finishStandard(
    target: WhatsappSignupTarget,
    input: { pin?: string }
  ): Promise<WhatsappSignupResult>
  /**
   * Mitad irreversible del **flujo de Coexistence**: solo la suscripción, con
   * los tres campos. No hay `register` y no hay solicitud de historial acá; la
   * solicitud sale en un job, después de persistir (ver más abajo).
   */
  subscribe(
    accessToken: string,
    wabaId: string,
    options?: { subscribedFields?: readonly string[] }
  ): Promise<void>
  resolveOwnership(
    tenantId: string,
    phoneNumberId: string
  ): Promise<WhatsappNumberOwnership>
  connect(
    tenantId: string,
    input: WhatsappNumberInput
  ): Promise<ConnectedPageRecord>
  /** Encola `{ type: "history_sync_request", connectionId }` en `WHATSAPP_JOBS`. */
  enqueueHistorySync(connectionId: string): Promise<void>
  /** Deja el estado del import visible cuando el encolado no salió. */
  markHistorySyncStatus(
    connectionId: string,
    status: HistorySyncStatus
  ): Promise<unknown>
}

export type WhatsappSignupRequest = {
  tenantId: string
  code: string
  /** La pista del navegador. No es autoritativa: Graph la confirma. */
  wabaId: string
  /** `null` es legítimo en Coexistence: Graph resuelve el número vinculado. */
  phoneNumberId: string | null
  mode: WhatsappOnboardingMode
  /** El PIN que aportó el cliente tras un 133005, ya normalizado. */
  pin: string | null
}

export type WhatsappSignupOutcome =
  | {
      kind: "connected"
      page: ConnectedPageRecord
      mode: WhatsappOnboardingMode
      /** `true` solo cuando el PIN lo creamos nosotros y hay que enseñárselo. */
      pinGenerated: boolean
      /** Estado con el que quedó el import; `null` en el flujo estándar. */
      historySync: HistorySyncStatus | null
      /** Por qué no se pudo encolar la solicitud de historial, si pasó. */
      historySyncError: string | null
    }
  // El 133005: el número ya tenía verificación en dos pasos con un PIN que no
  // es el nuestro. Sale aparte de `failed` porque el remedio es del cliente y
  // está a un campo de distancia.
  | { kind: "pin_required"; metaErrorCode: number | null }
  | { kind: "owned_by_other_tenant"; phoneNumberId: string }
  | {
      kind: "failed"
      step: WhatsappOnboardingStep
      metaErrorCode: number | null
      errorMessage: string
    }

// El motivo del log es del catálogo cerrado de `logger.ts` y no el del
// querystring: uno se filtra en Workers Logs y el otro se le muestra a una
// persona. Es un `Record` sobre `WhatsappOnboardingStep` para que un paso nuevo
// en el cliente no compile hasta que alguien decida cómo se filtra.
export const LOG_REASON_BY_STEP: Record<WhatsappOnboardingStep, LogReason> = {
  exchange: "token_exchange_failed",
  assets: "profile_fetch_failed",
  register: "meta_rejected",
  subscribe: "subscription_failed",
  // El historial se pide contra Meta, así que un fallo acá es un rechazo suyo y
  // no un problema nuestro de suscripción.
  sync_request: "meta_rejected",
  persist: "internal_error",
}

// De quién es el PIN que se acaba de usar. Se mira lo que **cambia** y no quién
// lo tecleó: si el cliente escribió exactamente el que ya teníamos —le pasa a
// quien lo copia de la propia tarjeta—, el PIN sigue siendo el que generamos
// nosotros y la marca no se toca.
export function resolveWhatsappPinOrigin(input: {
  submittedPin: string | null
  storedPin: string | null
  pinGenerated: boolean
}): WhatsappPinOrigin {
  if (input.pinGenerated) return "generated"
  if (input.submittedPin && input.submittedPin !== input.storedPin) {
    return "customer"
  }
  return input.storedPin ? "stored" : "customer"
}

// ---------------------------------------------------------------------------
// El cierre
// ---------------------------------------------------------------------------

export async function runWhatsappSignup(
  deps: WhatsappSignupDeps,
  request: WhatsappSignupRequest
): Promise<WhatsappSignupOutcome> {
  // El paso donde estamos, para atribuir un error que no venga tipado. Los
  // `WhatsappApiError` traen el suyo; esto cubre lo demás —una caída de la base
  // en la escritura, sobre todo—, igual que en el callback de Instagram.
  let step: WhatsappOnboardingStep = "exchange"

  try {
    // Mitad reversible: canje, `debug_token`, WABA y lista de números. Cuando
    // esto vuelve, en Meta no cambió nada todavía.
    const target = await deps.begin({
      code: request.code,
      hint: { wabaId: request.wabaId, phoneNumberId: request.phoneNumberId },
      mode: request.mode,
    })

    // **El punto de no retorno está entre estas dos llamadas.** La propiedad se
    // consulta con el `phone_number_id` que confirmó Graph —no con el que dijo
    // el navegador— y antes de suscribir y registrar, porque `/register` activa
    // la verificación en dos pasos con el PIN que le mandemos y eso no se
    // deshace desde acá.
    //
    // El fallo de esta lectura se atribuye a `persist`: es nuestra base, no
    // Meta, y su mensaje («se autorizó pero no se pudo guardar, vuelve a
    // intentarlo») es el correcto. Se aborta en vez de seguir sin respuesta: no
    // poder confirmar de quién es el número no es lo mismo que que sea tuyo.
    step = "persist"
    const ownership = await deps.resolveOwnership(
      request.tenantId,
      target.phone.id
    )
    if (ownership.ownedByOtherTenant) {
      return { kind: "owned_by_other_tenant", phoneNumberId: target.phone.id }
    }

    return request.mode === "coexistence"
      ? await finishCoexistence(deps, request, target)
      : await finishStandard(deps, request, target, ownership)
  } catch (error) {
    if (error instanceof WhatsappApiError) {
      if (error.reason === "pin_required") {
        return { kind: "pin_required", metaErrorCode: error.metaErrorCode }
      }
      return {
        kind: "failed",
        step: error.step,
        metaErrorCode: error.metaErrorCode,
        errorMessage: error.message,
      }
    }

    if (error instanceof PageOwnershipError) {
      return { kind: "owned_by_other_tenant", phoneNumberId: error.metaPageId }
    }

    return {
      kind: "failed",
      step,
      metaErrorCode: null,
      errorMessage: error instanceof Error ? error.message : "unknown error",
    }
  }
}

// Flujo A. Suscribe el WABA y **registra el número**, que es lo que lo pone en
// servicio en Cloud API y lo que le activa la verificación en dos pasos.
async function finishStandard(
  deps: WhatsappSignupDeps,
  request: WhatsappSignupRequest,
  target: WhatsappSignupTarget,
  ownership: WhatsappNumberOwnership
): Promise<WhatsappSignupOutcome> {
  // De dónde sale el PIN, en orden de autoridad: el que escribió el cliente
  // tras un 133005 manda sobre el que tengamos guardado, porque si lo está
  // escribiendo es que el nuestro ya no vale. Sin ninguno de los dos,
  // `finishStandard` genera uno: es el caso normal de un número sin 2FA.
  const pin = request.pin ?? ownership.storedPin

  const signup = await deps.finishStandard(target, pin ? { pin } : {})

  const pinOrigin = resolveWhatsappPinOrigin({
    submittedPin: request.pin,
    storedPin: ownership.storedPin,
    pinGenerated: signup.pinGenerated,
  })

  // Se persiste lo que **confirmó Graph**, no lo que dijo el navegador: el
  // `phoneNumberId` y el `wabaId` que salen del cliente ya pasaron por
  // `debug_token` y por `/{waba_id}/phone_numbers`. Usar acá los del formulario
  // desharía esa validación entera.
  const page = await deps.connect(request.tenantId, {
    phoneNumberId: signup.phoneNumberId,
    wabaId: signup.wabaId,
    wabaName: signup.wabaName,
    phoneE164: signup.phoneE164,
    verifiedName: signup.verifiedName,
    accessToken: signup.accessToken,
    tokenExpiresAt: signup.tokenExpiresAt,
    pin: signup.pin,
    pinOrigin,
    onboardingMode: "standard",
    // El flujo estándar es un número nuevo: no hay conversaciones previas que
    // traer, así que no tiene estado de import. `null` y no `'complete'`, que
    // diría que un import terminó.
    historySyncStatus: null,
  })

  return {
    kind: "connected",
    page,
    mode: "standard",
    pinGenerated: signup.pinGenerated,
    historySync: null,
    historySyncError: null,
  }
}

// Flujo B. **No llama a `/register` en ningún camino**: registrar un número que
// ya opera desde la app de WhatsApp Business lo desvincula de la app, que es
// exactamente lo que Coexistence existe para no hacer. Tampoco hay PIN: sin
// registro no hay verificación en dos pasos que activar.
async function finishCoexistence(
  deps: WhatsappSignupDeps,
  request: WhatsappSignupRequest,
  target: WhatsappSignupTarget
): Promise<WhatsappSignupOutcome> {
  // Los tres campos **antes** de que el número entre en servicio: `history` es
  // el que trae el historial que el negocio aceptó compartir, y si la
  // suscripción llega tarde los chunks que Meta ya disparó no vuelven —el sync
  // se pide una vez y el reloj de 24 horas no se reinicia—.
  await deps.subscribe(target.accessToken, target.wabaId, {
    subscribedFields: WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS,
  })

  const page = await deps.connect(request.tenantId, {
    phoneNumberId: target.phone.id,
    wabaId: target.wabaId,
    wabaName: target.wabaName,
    phoneE164: target.phone.phoneE164,
    verifiedName: target.phone.verifiedName,
    accessToken: target.accessToken,
    tokenExpiresAt: target.tokenExpiresAt,
    // Sin PIN y con origen `stored`: no hay PIN nuevo que escribir, y la marca
    // no se toca —si este número ya estuvo registrado alguna vez, su PIN sigue
    // siendo el que era—.
    pin: null,
    pinOrigin: "stored",
    onboardingMode: "coexistence",
    historySyncStatus: "not_requested",
  })

  // **Persistir primero y pedir el historial después, desde un job.** El orden
  // es al revés de lo que sugiere «terminar el onboarding»: la solicitud
  // arranca un reloj de 24 horas que no se reinicia, y arrancarlo antes de
  // tener la fila dejaría un número con el plazo corriendo y sin nada en la
  // base que lo recuerde. Con la fila escrita, el peor caso es un job que se
  // reintenta.
  //
  // **Y el encolado no puede fallar en silencio.** Si no sale, nadie va a pedir
  // ese historial nunca y el plazo se agota igual, así que el estado queda en
  // `failed` —visible en la tarjeta, con su acción— en vez de en
  // `not_requested`, que se lee como «todavía no le tocó».
  try {
    await deps.enqueueHistorySync(page.id)
  } catch (error) {
    const historySyncError =
      error instanceof Error ? error.message : "unknown error"
    await deps.markHistorySyncStatus(page.id, "failed")
    return {
      kind: "connected",
      page,
      mode: "coexistence",
      pinGenerated: false,
      historySync: "failed",
      historySyncError,
    }
  }

  return {
    kind: "connected",
    page,
    mode: "coexistence",
    pinGenerated: false,
    historySync: "not_requested",
    historySyncError: null,
  }
}

// ---------------------------------------------------------------------------
// El cupo del plan
// ---------------------------------------------------------------------------

export type WhatsappPlanSlotDeps = {
  countActivePages(tenantId: string): Promise<number>
  resolveMaxPages(tenantId: string): Promise<number | null>
  resolveOwnership(
    tenantId: string,
    phoneNumberId: string
  ): Promise<WhatsappNumberOwnership>
}

export type WhatsappPlanSlotResult =
  | { ok: true }
  | { ok: false; reason: LogReason; message: string }

/**
 * El cupo del plan, **antes** de tocar Meta —y por tanto antes del canje, que
 * quema el `code` al primer uso—. Sin esta puerta el número se conecta igual y
 * el tenant se pasa del límite, que es lo que apaga la entrega de sus páginas de
 * Messenger (ver `checkAccountSlotAvailable`).
 *
 * **La pista del navegador alcanza para esto.** El `phone_number_id` que llega
 * en el cierre no es autoritativo, pero solo se usa para *conceder* la exención
 * de reconexión, y `resolveWhatsappPhoneNumber` aborta el onboarding si el
 * número que Graph devuelve no es exactamente ese: o el flujo sigue con el mismo
 * número, o no sigue.
 *
 * En Coexistence puede no haber pista —el popup a veces solo reporta el
 * `waba_id`—, y entonces no hay exención y el cupo se aplica entero. Es el lado
 * correcto en el que fallar: quien esté al límite reconectando un número de
 * Coexistence verá el mensaje del cupo, y no habrá una fila de más.
 */
export async function checkWhatsappPlanSlot(
  deps: WhatsappPlanSlotDeps,
  input: { tenantId: string; phoneNumberId: string | null },
  t: AppDict
): Promise<WhatsappPlanSlotResult> {
  let maxPages: number | null
  let activePageCount: number
  let reconnectingActiveAccount = false

  try {
    ;[maxPages, activePageCount] = await Promise.all([
      deps.resolveMaxPages(input.tenantId),
      deps.countActivePages(input.tenantId),
    ])
    if (input.phoneNumberId) {
      const ownership = await deps.resolveOwnership(
        input.tenantId,
        input.phoneNumberId
      )
      reconnectingActiveAccount = ownership.activeForTenant
    }
  } catch {
    // Fail-closed y con mensaje: sin saber el cupo, conectar es apostar a que
    // hay hueco.
    return {
      ok: false,
      reason: "internal_error",
      message: t.actions.quotaCheckFailed,
    }
  }

  // Plan sin resolver = fail-closed, igual que en `/connections/select` y en el
  // callback de Instagram: no se conectan cuentas sin un límite conocido.
  if (maxPages === null) {
    return {
      ok: false,
      reason: "plan_restricted",
      message: t.actions.planUnresolved,
    }
  }

  const slot = checkAccountSlotAvailable(
    { activePageCount, maxPages, reconnectingActiveAccount },
    t
  )
  if (slot.ok) return { ok: true }

  return { ok: false, reason: "page_limit_reached", message: slot.message }
}
