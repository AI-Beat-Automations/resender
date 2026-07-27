import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  assertSecretEncryptionConfigured,
  SecretEncryptionConfigError,
} from "@/lib/crypto/encryption"
import { APP_URL, STATE_COOKIE, exchangeCodeForUserToken } from "@/lib/meta"
import { saveMetaUserAccessToken } from "@/lib/pages/meta-user-token"
import { posthog } from "@/lib/posthog"

// Meta redirige aquí con ?code=...&state=... tras aprobar el diálogo.
// El callback ya no conecta nada (ADR 0004): solo persiste cifrado el user
// access token de larga duración y manda a la pantalla de selección, donde el
// usuario elige qué páginas conectar. Así los page tokens de las páginas
// descartadas nunca llegan a la base.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", APP_URL))
  }

  if (await isUserWaitlisted(session.user.id)) {
    return NextResponse.redirect(new URL("/waitlist", APP_URL))
  }

  if (!(await hasActiveSubscription(session.user.id))) {
    return NextResponse.redirect(new URL("/billing", APP_URL))
  }

  const params = request.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")

  const connections = new URL("/connections", APP_URL)
  const fail = (reason: string) => {
    connections.searchParams.set("meta", "error")
    connections.searchParams.set("reason", reason)
    const res = NextResponse.redirect(connections)
    res.cookies.delete(STATE_COOKIE)
    return res
  }

  // el usuario canceló o Meta devolvió error
  if (error || !code) return fail(error ?? "missing_code")

  // CSRF: el state del query debe coincidir con la cookie que sembró /start
  const expected = request.cookies.get(STATE_COOKIE)?.value
  if (!state || !expected || state !== expected) return fail("state_mismatch")

  try {
    assertSecretEncryptionConfigured()
    const userToken = await exchangeCodeForUserToken(code)
    await saveMetaUserAccessToken(session.user.id, userToken)

    const res = NextResponse.redirect(new URL("/connections/select", APP_URL))
    res.cookies.delete(STATE_COOKIE)
    return res
  } catch (error) {
    if (posthog) posthog.captureException(error, session.user.id)
    console.error("meta connection failed", error)
    if (error instanceof SecretEncryptionConfigError) {
      return fail("configuration_failed")
    }
    return fail("exchange_failed")
  }
}
