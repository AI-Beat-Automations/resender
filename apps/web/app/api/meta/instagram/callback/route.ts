import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveInstagramAccess } from "@/lib/auth/channel-access"
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
  exchangeCodeForInstagramToken,
  fetchInstagramProfile,
  InstagramApiError,
  INSTAGRAM_STATE_COOKIE,
  subscribeInstagramWebhook,
} from "@/lib/instagram"
import { APP_URL } from "@/lib/meta"
import {
  accountFields,
  describeError,
  log,
  type LogReason,
} from "@/lib/observability/logger"
import { instagramAccountOwnedReason } from "@/lib/pages/meta-connection-error"
import {
  connectInstagramAccount,
  countActivePages,
  getActivePageByMetaPageId,
  PageOwnershipError,
} from "@/lib/pages/page-registry"
import { posthog } from "@/lib/posthog"

// Instagram redirige acá con ?code=...&state=... tras aprobar el diálogo.
//
// A diferencia del callback de Facebook, este **sí conecta**. La ADR 0004 mandó
// la selección a una pantalla aparte porque Facebook devuelve N páginas y
// persistir los page tokens de las que el usuario no eligió era el problema;
// Instagram Login autoriza exactamente una cuenta, así que no hay nada que
// elegir y una pantalla intermedia solo agregaría un clic.
//
// El orden importa: primero se suscribe al webhook y recién después se guarda.
// Una cuenta guardada que no recibe eventos se ve conectada y está muda; una
// suscripción sin fila en la base no le hace nada a nadie —los eventos llegan y
// no resuelven a ningún tenant— y se limpia sola al reintentar.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  // Los gates de abajo redirigen y hasta ahora no dejaban rastro: desde afuera,
  // «me rebotó a /login» y «no llegué nunca» se ven igual.
  const gate = (reason: LogReason, to: string) => {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "dropped",
      reason,
      channel: "instagram",
      route: "/api/meta/instagram/callback",
    })
    return NextResponse.redirect(new URL(to, APP_URL))
  }

  const session = await auth()
  if (!session?.user?.id) {
    return gate("not_authenticated", "/login")
  }

  // Ver el comentario en `/api/meta/instagram/start`.
  const access = await resolveProductAccess(session.user.id)
  if (access === "unknown_user") {
    return gate("not_authenticated", "/login")
  }
  if (access === "waitlisted") {
    return gate("waitlisted", "/pending")
  }

  if (!(await hasActiveSubscription(session.user.id))) {
    return gate("no_active_subscription", "/billing")
  }

  const params = request.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")

  const connections = new URL("/connections", APP_URL)
  const finish = (search: Record<string, string>) => {
    for (const [key, value] of Object.entries(search)) {
      connections.searchParams.set(key, value)
    }
    const res = NextResponse.redirect(connections)
    res.cookies.delete(INSTAGRAM_STATE_COOKIE)
    return res
  }

  // El motivo del querystring es para la pantalla; el del log es del catálogo
  // cerrado y es el que se filtra. Van juntos para que no se separen.
  const fail = (
    reason: string,
    logReason: LogReason,
    extra: { errorMessage?: string; level?: "warn" } = {}
  ) => {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      // Un gate cerrado es un descarte, igual que una cancelación: nada se
      // rompió y no tiene que aparecer entre los fallos que sí hay que mirar.
      outcome:
        logReason === "user_cancelled" || logReason === "channel_not_enabled"
          ? "dropped"
          : "failed",
      reason: logReason,
      channel: "instagram",
      route: "/api/meta/instagram/callback",
      tenantId: session.user.id,
      ...extra,
    })
    return finish({ instagram: "error", reason })
  }

  // El usuario canceló, o Instagram devolvió error. `error_description` trae el
  // detalle pero es texto de Meta en inglés: nos quedamos con el código, que es
  // lo que el catálogo de mensajes sabe traducir.
  if (error) return fail(error, "user_cancelled")

  // Antes de tocar el `code`: quien perdió el permiso entre /start y el
  // callback trae una autorización válida de Meta, y canjearla guardaría una
  // cuenta que el canal no puede atender. Va por `fail` y no por `gate` para
  // que se limpie la cookie de `state` del intento que queda trunco, y después
  // de mirar `error` para que una cancelación no se registre como revocación.
  if (!(await resolveInstagramAccess(session.user.id))) {
    return fail("instagram_not_enabled", "channel_not_enabled")
  }

  if (!code) return fail("missing_code", "missing_code")

  // CSRF: el state del query debe coincidir con la cookie que sembró /start.
  const expected = request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value
  if (!state || !expected || state !== expected) {
    // A `warn`: un state que no coincide es o un intento de CSRF o dos
    // diálogos abiertos a la vez, y las dos cosas ameritan mirarlas.
    return fail("state_mismatch", "state_mismatch", { level: "warn" })
  }

  // Cupo del plan (ADR 0011), en el mismo lugar y por el mismo motivo que el
  // gate de canal de arriba: el `code` se quema al usarse una vez, y rebotar
  // después dejaría al usuario sin poder reintentar. Instagram ocupa slot igual
  // que una Página, así que este es el camino por el que se rompería el
  // invariante si no estuviera.
  //
  // **Por qué el rebote no ocurre acá.** Reconectar una cuenta que ya está
  // `active` para este tenant es idempotente y no consume slot nuevo
  // ([Reconexión de páginas]), pero cuál es la cuenta de IG solo se sabe
  // después del intercambio: `exchangeCodeForInstagramToken` no devuelve el IG
  // user id y ningún paso anterior lo expone —el `state` es un nonce de CSRF y
  // el diálogo no lo manda—. Rebotar acá con `activePageCount >= maxPages`
  // rompería el caso del que está en el tope y solo quiere reconectar lo que ya
  // tiene. Así que acá se resuelve el número (y se rebota si el plan no se
  // puede resolver, que sí es independiente de la cuenta) y la decisión se toma
  // abajo, sabiendo el IG id. El costo de esa demora es un `code` quemado en el
  // único caso que igual iba a rebotar: el que está al tope y conecta una
  // cuenta nueva.
  const subscription = await getSubscriptionByTenantId(session.user.id)
  const limits = resolvePlanLimits(subscription?.priceLookupKey ?? null)
  if (!limits) {
    return fail("configuration_failed", "configuration_failed", {
      errorMessage: "plan limits could not be resolved",
    })
  }
  const atPageLimit =
    (await countActivePages(session.user.id)) >= limits.maxPages

  let step: "exchange" | "profile" | "subscribe" | "persist" = "exchange"
  try {
    assertSecretEncryptionConfigured()

    const token = await exchangeCodeForInstagramToken(code)

    step = "profile"
    const profile = await fetchInstagramProfile(token.accessToken)

    // Con el IG id en la mano: sin cupo libre solo pasa la reconexión de una
    // cuenta que ya está activa para este tenant. Comparar el `tenantId` es lo
    // que impide que la cuenta ajena abra la puerta.
    // La cuenta de otro tenant rebota por propiedad y no por cupo: decirle
    // "liberá un slot" a quien intenta conectar una cuenta que no es suya lo
    // manda a desconectar conexiones para nada, porque después va a rebotar
    // igual con `PageOwnershipError` (ADR 0004).
    if (atPageLimit) {
      const existing = await getActivePageByMetaPageId(
        profile.igUserId,
        "instagram"
      )
      if (existing && existing.tenantId !== session.user.id) {
        return fail(
          instagramAccountOwnedReason(profile.igUserId),
          "account_owned_by_other_tenant",
          { errorMessage: `accountId=${profile.igUserId}` }
        )
      }
      if (!existing) {
        return fail("instagram_page_limit_reached", "page_limit_reached")
      }
    }

    step = "subscribe"
    await subscribeInstagramWebhook(token.accessToken)

    step = "persist"
    const account = await connectInstagramAccount(session.user.id, {
      igUserId: profile.igUserId,
      username: profile.username,
      name: profile.name,
      accessToken: token.accessToken,
      tokenExpiresAt: token.expiresAt,
    })

    if (posthog) {
      posthog.capture({
        distinctId: session.user.id,
        event: "instagram account connected",
        properties: {
          connection_id: account.id,
          ig_user_id: account.metaPageId,
          username: account.username,
        },
      })
      await posthog.flush()
    }

    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "ok",
      route: "/api/meta/instagram/callback",
      ...accountFields(account),
    })

    // Solo el @handle viaja en la URL. El token quedó cifrado en Postgres y el
    // IG ID no le dice nada al usuario.
    return finish({ instagram: "connected", username: profile.username })
  } catch (error) {
    if (posthog) posthog.captureException(error, session.user.id)
    const errorMessage = describeError(error)

    if (error instanceof SecretEncryptionConfigError) {
      return fail("configuration_failed", "configuration_failed", {
        errorMessage,
      })
    }
    if (error instanceof PageOwnershipError) {
      return fail(
        instagramAccountOwnedReason(error.metaPageId),
        "account_owned_by_other_tenant",
        { errorMessage: `accountId=${error.metaPageId}` }
      )
    }
    // `step` ya distingue en qué paso del orden intercambio → perfil →
    // suscripción se cayó, y es exactamente la distinción que el catálogo de
    // motivos necesita. Hasta ahora solo se veía como querystring.
    if (error instanceof InstagramApiError) {
      return error.step === "subscribe"
        ? fail("instagram_subscription_failed", "subscription_failed", {
            errorMessage,
          })
        : error.step === "profile"
          ? fail("instagram_profile_failed", "profile_fetch_failed", {
              errorMessage,
            })
          : fail("instagram_exchange_failed", "token_exchange_failed", {
              errorMessage,
            })
    }
    return fail("instagram_exchange_failed", "internal_error", {
      errorMessage: `${step}: ${errorMessage}`,
    })
  }
}
