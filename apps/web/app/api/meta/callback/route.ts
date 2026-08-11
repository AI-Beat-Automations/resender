import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  assertSecretEncryptionConfigured,
  SecretEncryptionConfigError,
} from "@/lib/crypto/encryption"
import { APP_URL, STATE_COOKIE, exchangeCodeForUserToken } from "@/lib/meta"
import {
  describeError,
  log,
  type LogReason,
} from "@/lib/observability/logger"
import { saveMetaUserAccessToken } from "@/lib/pages/meta-user-token"
import { posthog } from "@/lib/posthog"

// Meta redirige aquí con ?code=...&state=... tras aprobar el diálogo.
// El callback ya no conecta nada (ADR 0004): solo persiste cifrado el user
// access token de larga duración y manda a la pantalla de selección, donde el
// usuario elige qué páginas conectar. Así los page tokens de las páginas
// descartadas nunca llegan a la base.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  // Los gates redirigen y hasta ahora no dejaban rastro: «me rebotó a /login» y
  // «no llegué nunca» se ven igual desde afuera.
  const gate = (reason: LogReason, to: string) => {
    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "dropped",
      reason,
      channel: "messenger",
      route: "/api/meta/callback",
    })
    return NextResponse.redirect(new URL(to, APP_URL))
  }

  const session = await auth()
  if (!session?.user?.id) {
    return gate("not_authenticated", "/login")
  }

  // Ver el comentario en `/api/meta/start`.
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
      channel: "messenger",
      route: "/api/meta/callback",
      tenantId: session.user.id,
      ...extra,
    })
    connections.searchParams.set("meta", "error")
    connections.searchParams.set("reason", reason)
    const res = NextResponse.redirect(connections)
    res.cookies.delete(STATE_COOKIE)
    return res
  }

  // el usuario canceló o Meta devolvió error
  if (error) return fail(error, "user_cancelled")
  if (!code) return fail("missing_code", "missing_code")

  // CSRF: el state del query debe coincidir con la cookie que sembró /start
  const expected = request.cookies.get(STATE_COOKIE)?.value
  if (!state || !expected || state !== expected) {
    return fail("state_mismatch", "state_mismatch", { level: "warn" })
  }

  try {
    assertSecretEncryptionConfigured()
    const userToken = await exchangeCodeForUserToken(code)
    await saveMetaUserAccessToken(session.user.id, userToken)

    log({
      entrypoint: "route",
      action: "oauth_callback",
      outcome: "ok",
      channel: "messenger",
      route: "/api/meta/callback",
      tenantId: session.user.id,
    })

    const res = NextResponse.redirect(new URL("/connections/select", APP_URL))
    res.cookies.delete(STATE_COOKIE)
    return res
  } catch (error) {
    if (posthog) posthog.captureException(error, session.user.id)
    const errorMessage = describeError(error)
    if (error instanceof SecretEncryptionConfigError) {
      return fail("configuration_failed", "configuration_failed", {
        errorMessage,
      })
    }
    return fail("exchange_failed", "token_exchange_failed", { errorMessage })
  }
}
