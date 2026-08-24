import { getCloudflareContext } from "@opennextjs/cloudflare"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { resolvePlanLimits } from "@/lib/billing/entitlements"
import {
  getSubscriptionByTenantId,
  hasActiveSubscription,
} from "@/lib/billing/subscription"
import {
  assertSecretEncryptionConfigured,
  SecretEncryptionConfigError,
} from "@/lib/crypto/encryption"
import {
  beginWhatsappSignup,
  finishWhatsappSignup,
  normalizeWhatsappPin,
  subscribeWhatsappWebhook,
} from "@/lib/meta/whatsapp-client"
import {
  accountFields,
  describeError,
  log,
  type LogReason,
} from "@/lib/observability/logger"
import {
  formatMetaConnectionError,
  whatsappNumberOwnedReason,
  whatsappStepFailedReason,
} from "@/lib/pages/meta-connection-error"
import {
  connectWhatsappNumber,
  countActivePages,
  resolveWhatsappNumberOwnership,
  updateWhatsappHistorySyncStatus,
} from "@/lib/pages/page-registry"
import { posthog } from "@/lib/posthog"

import { parseWhatsappMode } from "@/features/connect-whatsapp/signup-launch"
import { consumeSignupNonce } from "@/features/connect-whatsapp/signup-nonce"
import {
  checkWhatsappPlanSlot,
  LOG_REASON_BY_STEP,
  runWhatsappSignup,
} from "@/features/connect-whatsapp/signup-flow"

// Cierre del Embedded Signup de WhatsApp, del lado del servidor. El launcher
// —el botón que abre el popup de `FB.login`— captura el `code` y los
// identificadores que Meta manda por `postMessage`, y hace `POST` acá. Todo lo
// que sigue (canje, confirmación de propiedad, registro, suscripción y
// persistencia cifrada) pasa en el servidor: **el navegador nunca ve un
// token**, y al navegador tampoco vuelve ninguno.
//
// **Por qué es un POST y no un GET como los otros dos callbacks.** Messenger e
// Instagram entran por redirección: Meta navega a `/api/meta/.../callback` con
// el `code` en el query. Embedded Signup no redirige a ningún sitio —es un
// popup que devuelve el `code` a la pestaña que lo abrió—, así que no hay
// navegación que atender: hay un cuerpo que recibir. Y por eso el CSRF no lo
// cubre una cookie de `state` sembrada por `/start` sino el nonce de
// `signup-nonce.ts`, que es el mismo mecanismo adaptado a que no hay ida y
// vuelta por Meta.
//
// La respuesta es JSON con la URL a la que ir, no un `redirect`: quien llama es
// un `fetch`, y un 302 acá lo seguiría en silencio y dejaría la pantalla igual.
export const runtime = "nodejs"

type CallbackResponse =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string; pinRequired?: boolean }

export async function POST(request: NextRequest) {
  const gate = (reason: LogReason, error: string, status = 403) => {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "dropped",
      reason,
      channel: "whatsapp",
      route: "/api/meta/whatsapp/callback",
    })
    return NextResponse.json<CallbackResponse>({ ok: false, error }, { status })
  }

  const session = await auth()
  if (!session?.user?.id) {
    return gate("not_authenticated", "No has iniciado sesión.", 401)
  }
  const tenantId = session.user.id

  // Los mismos gates de las rutas de los otros dos canales y en el mismo orden.
  // Se repiten aunque el layout de `(product)` ya los aplique: esto se puede
  // invocar por POST directo sin renderizar la pantalla.
  const access = await resolveProductAccess(tenantId)
  if (access === "unknown_user") {
    return gate("not_authenticated", "No has iniciado sesión.", 401)
  }
  if (access === "waitlisted") {
    return gate("waitlisted", "Tu cuenta está en la lista de espera.")
  }
  if (!(await hasActiveSubscription(tenantId))) {
    return gate("no_active_subscription", "Tu suscripción no está activa.")
  }
  if (!(await resolveWhatsappAccess(tenantId))) {
    return gate(
      "channel_not_enabled",
      formatMetaConnectionError("whatsapp_not_enabled")
    )
  }

  const fail = (
    reason: string,
    logReason: LogReason,
    extra: {
      errorMessage?: string
      errorCode?: number
      accountId?: string
      level?: "warn"
    } = {}
  ) => {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: logReason,
      channel: "whatsapp",
      route: "/api/meta/whatsapp/callback",
      tenantId,
      ...extra,
    })
    return NextResponse.json<CallbackResponse>({
      ok: false,
      error: formatMetaConnectionError(reason),
    })
  }

  const body = await readBody(request)
  const store = await cookies()

  // El nonce se consume antes de mirar nada más: es el sustituto del `state` de
  // los otros dos canales y no tiene sentido inspeccionar el resto de un cuerpo
  // que todavía no probó venir de nuestra pestaña. Se consume incluso si el
  // cuerpo es ilegible —un cierre que no se puede leer gastó el nonce igual—.
  const validNonce = consumeSignupNonce(
    store,
    tenantId,
    readField(body, "nonce")
  )
  if (!validNonce) {
    // A `warn`, igual que en el callback de Instagram: es un intento de CSRF o
    // dos flujos abiertos a la vez, y las dos cosas ameritan mirarlas.
    return fail("whatsapp_state_mismatch", "state_mismatch", { level: "warn" })
  }

  const mode = parseWhatsappMode(readField(body, "mode"))
  const code = readField(body, "code")
  const wabaId = readField(body, "wabaId")
  const phoneNumberId = readField(body, "phoneNumberId")

  // El `phone_number_id` es obligatorio en el flujo estándar y opcional en
  // Coexistence, donde el popup a veces solo reporta el WABA y Graph resuelve
  // cuál de sus números está vinculado a la app de WhatsApp Business.
  if (!code || !wabaId || (mode === "standard" && !phoneNumberId)) {
    return fail("whatsapp_assets_failed", "missing_code", {
      // Qué faltó, sin decir qué llegó: el `code` no se registra nunca.
      errorMessage: `missing: ${[
        code ? null : "code",
        wabaId ? null : "wabaId",
        phoneNumberId ? null : "phoneNumberId",
      ]
        .filter(Boolean)
        .join(",")}`,
    })
  }

  // El PIN, si viene, se valida acá y no dentro del cliente de Meta: el
  // `maxLength={6}` del input es decoración y esto se puede invocar por POST
  // directo. Vuelve con `pinRequired` para que el campo siga en pantalla con el
  // mensaje debajo, que es donde está el remedio.
  const submittedPin = readField(body, "pin")
  let pin: string | null = null
  if (submittedPin !== null) {
    const normalized = normalizeWhatsappPin(submittedPin)
    if (!normalized.ok) {
      log({
        entrypoint: "route",
        action: "oauth_callback",
        outcome: "failed",
        reason: "invalid_request",
        channel: "whatsapp",
        route: "/api/meta/whatsapp/callback",
        tenantId,
        // El PIN nunca, ni siquiera el inválido: es la credencial del número.
        errorMessage: "whatsapp pin is not six digits",
      })
      return NextResponse.json<CallbackResponse>({
        ok: false,
        pinRequired: true,
        error: normalized.message,
      })
    }
    pin = normalized.value
  }

  // El cupo del plan, **antes** de tocar Meta: el `code` se quema al usarse una
  // vez, así que rebotar después dejaría al usuario sin poder reintentar.
  const slot = await checkWhatsappPlanSlot(
    {
      countActivePages,
      resolveMaxPages: async (id) => {
        const subscription = await getSubscriptionByTenantId(id)
        return (
          resolvePlanLimits(subscription?.priceLookupKey ?? null)?.maxPages ??
          null
        )
      },
      resolveOwnership: resolveWhatsappNumberOwnership,
    },
    { tenantId, phoneNumberId }
  )
  if (!slot.ok) {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: slot.reason,
      channel: "whatsapp",
      route: "/api/meta/whatsapp/callback",
      tenantId,
      ...(phoneNumberId ? { accountId: phoneNumberId } : {}),
    })
    return NextResponse.json<CallbackResponse>({
      ok: false,
      error: slot.message,
    })
  }

  try {
    assertSecretEncryptionConfigured()
  } catch (error) {
    if (error instanceof SecretEncryptionConfigError) {
      return fail("configuration_failed", "configuration_failed", {
        errorMessage: describeError(error),
      })
    }
    throw error
  }

  const outcome = await runWhatsappSignup(
    {
      begin: beginWhatsappSignup,
      finishStandard: finishWhatsappSignup,
      subscribe: subscribeWhatsappWebhook,
      resolveOwnership: resolveWhatsappNumberOwnership,
      connect: connectWhatsappNumber,
      enqueueHistorySync: async (connectionId) => {
        // La cola propia de WhatsApp, no la de entregas: un import de historial
        // son miles de jobs y en `webhook-deliveries` competirían en batches de
        // 10 con los pushes de todos los tenants.
        await getCloudflareContext().env.WHATSAPP_JOBS.send({
          type: "history_sync_request",
          connectionId,
        })
      },
      markHistorySyncStatus: (connectionId, status) =>
        updateWhatsappHistorySyncStatus({ connectionId, status, tenantId }),
    },
    { tenantId, code, wabaId, phoneNumberId, mode, pin }
  )

  if (outcome.kind === "pin_required") {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "failed",
      reason: "meta_rejected",
      channel: "whatsapp",
      route: "/api/meta/whatsapp/callback",
      tenantId,
      ...(outcome.metaErrorCode ? { errorCode: outcome.metaErrorCode } : {}),
      errorMessage: "register: two-step verification pin required",
    })
    // Vuelve como estado del botón y no como aviso de la pantalla porque el
    // remedio está justo ahí: aportar el PIN y volver a lanzar.
    return NextResponse.json<CallbackResponse>({
      ok: false,
      pinRequired: true,
      error:
        "No se pudo conectar: el número ya tiene la verificación en dos pasos activada. Vuelve a lanzar la conexión indicando su PIN de seis dígitos, o desactívala desde WhatsApp Manager e inténtalo de nuevo.",
    })
  }

  if (outcome.kind === "owned_by_other_tenant") {
    return fail(
      whatsappNumberOwnedReason(outcome.phoneNumberId),
      "account_owned_by_other_tenant",
      { accountId: outcome.phoneNumberId }
    )
  }

  if (outcome.kind === "failed") {
    if (posthog) {
      posthog.captureException(
        new Error(`whatsapp signup failed at ${outcome.step}`),
        tenantId
      )
    }
    // El paso exacto, en el log y en el motivo de la pantalla. Sin secretos: el
    // mensaje del error ya pasa por el `scrub` del logger, y ni el `code` ni el
    // PIN ni el token entran nunca en él.
    return fail(
      whatsappStepFailedReason(outcome.step),
      LOG_REASON_BY_STEP[outcome.step],
      {
        ...(outcome.metaErrorCode ? { errorCode: outcome.metaErrorCode } : {}),
        errorMessage: `${outcome.step}: ${outcome.errorMessage}`,
      }
    )
  }

  const { page } = outcome

  log({
    entrypoint: "route",
    action: "account_connect",
    outcome: "ok",
    route: "/api/meta/whatsapp/callback",
    ...accountFields(page),
  })

  // El encolado que no salió no puede pasar por «conectado y ya está»: el reloj
  // de 24 h corre igual y nadie va a pedir ese historial. Queda en `failed` en
  // la base —la tarjeta lo dice y ofrece rehacer el alta— y acá queda la línea
  // que lo explica.
  if (outcome.historySyncError) {
    log({
      entrypoint: "route",
      action: "account_connect",
      outcome: "failed",
      reason: "internal_error",
      channel: "whatsapp",
      route: "/api/meta/whatsapp/callback",
      tenantId,
      connectionId: page.id,
      errorMessage: `sync_request enqueue: ${outcome.historySyncError}`,
    })
  }

  if (posthog) {
    posthog.capture({
      distinctId: tenantId,
      event: "whatsapp number connected",
      properties: {
        connection_id: page.id,
        phone_number_id: page.metaPageId,
        waba_id: page.wabaId,
        onboarding_mode: outcome.mode,
        // El booleano, nunca el PIN: distingue «se lo creamos» de «ya lo
        // tenía», que es lo que decide si hay que mostrárselo.
        pin_generated: outcome.pinGenerated,
        history_sync: outcome.historySync,
      },
    })
    await posthog.flush()
  }

  revalidatePath("/connections")

  // Solo el número en E.164 viaja en la URL: es lo que el usuario reconoce, y
  // el `phone_number_id` no se parece a nada suyo. El token quedó cifrado en
  // Postgres, y el PIN también: un PIN en el querystring acabaría en el
  // historial del navegador y en los logs del borde.
  const params = new URLSearchParams({ whatsapp: "connected" })
  if (page.whatsappPhoneE164) params.set("phone", page.whatsappPhoneE164)
  if (outcome.historySync === "failed") params.set("sync", "failed")
  if (outcome.pinGenerated) params.set("pin", "generated")

  return NextResponse.json<CallbackResponse>({
    ok: true,
    redirectTo: `/connections?${params.toString()}`,
  })
}

async function readBody(
  request: NextRequest
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    // Un cuerpo ilegible se trata como un cuerpo vacío: cae en el
    // `state_mismatch` de arriba, que es la conclusión correcta —esto no vino
    // de nuestro launcher— sin una rama extra que decir lo mismo.
    return {}
  }
}

function readField(body: Record<string, unknown>, name: string): string | null {
  const value = body[name]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
