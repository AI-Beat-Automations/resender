import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
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
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { evaluateAccountSlot } from "@/lib/pages/account-allowance"
import { instagramAccountOwnedReason } from "@/lib/pages/meta-connection-error"
import {
  connectInstagramAccount,
  getAccountOwnership,
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
    return gate("waitlisted", "/waitlist")
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
      outcome: logReason === "user_cancelled" ? "dropped" : "failed",
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
  if (!code) return fail("missing_code", "missing_code")

  // CSRF: el state del query debe coincidir con la cookie que sembró /start.
  const expected = request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value
  if (!state || !expected || state !== expected) {
    // A `warn`: un state que no coincide es o un intento de CSRF o dos
    // diálogos abiertos a la vez, y las dos cosas ameritan mirarlas.
    return fail("state_mismatch", "state_mismatch", { level: "warn" })
  }

  let step: "exchange" | "profile" | "allowance" | "subscribe" | "persist" =
    "exchange"
  try {
    assertSecretEncryptionConfigured()

    const token = await exchangeCodeForInstagramToken(code)

    step = "profile"
    const profile = await fetchInstagramProfile(token.accessToken)

    // Gate de cupo (ADR 0010). Va acá y no antes porque necesita el IG ID: sin
    // él no se distingue una re-autorización —que no consume slot— de una cuenta
    // nueva. Y va antes de la suscripción para no dejarle a Meta una suscripción
    // colgando de una cuenta que después rechazamos.
    //
    // Sin este gate, conectar una cuenta de más empujaría al tenant a
    // `page_limit_exceeded`, que bloquea **los dos canales**: mataría en
    // silencio su tráfico de Messenger.
    //
    // La cuenta de otro tenant no entra: ese caso es de propiedad, lo resuelve
    // `PageOwnershipError` más abajo, y decirle «no te queda cupo» le mentiría
    // sobre la causa.
    step = "allowance"
    const ownership = await getAccountOwnership({
      tenantId: session.user.id,
      channel: "instagram",
      metaPageId: profile.igUserId,
    })
    if (ownership.owner !== "other") {
      const entitlement = await getTenantEntitlement(session.user.id)
      if (!entitlement.limits) {
        return fail("plan_unavailable", "configuration_failed")
      }
      const slot = evaluateAccountSlot({
        maxAccounts: entitlement.limits.maxAccounts,
        activeAccountCount: entitlement.activeAccountCount,
        existingStatus: ownership.owner === "self" ? ownership.status : null,
      })
      if (!slot.ok) return fail(slot.code, "page_limit_reached")
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
