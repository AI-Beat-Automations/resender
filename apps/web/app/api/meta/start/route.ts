import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { log, type LogReason } from "@/lib/observability/logger"
import { STATE_COOKIE, buildDialogUrl } from "@/lib/meta"

// Arranca el OAuth: genera un `state` (CSRF), lo guarda en cookie httpOnly y
// redirige al diálogo de Meta. El botón "Conectar Facebook" apunta aquí.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  // Los tres gates redirigen. Sin línea, «el botón no hace nada» y «el botón
  // me manda a facturación» se investigan a ciegas.
  const gate = (reason: LogReason, to: string) => {
    log({
      entrypoint: "route",
      action: "oauth_start",
      outcome: "dropped",
      reason,
      channel: "messenger",
      route: "/api/meta/start",
    })
    return NextResponse.redirect(new URL(to, request.url))
  }

  const session = await auth()
  if (!session?.user?.id) {
    return gate("not_authenticated", "/login")
  }

  // Una sesión huérfana vuelve a `/login` y no a `/pending`: la pantalla del
  // gate da por buena la sesión y de una credencial rota solo se sale
  // volviendo a autenticarse.
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

  log({
    entrypoint: "route",
    action: "oauth_start",
    outcome: "ok",
    channel: "messenger",
    route: "/api/meta/start",
    tenantId: session.user.id,
  })

  const state = crypto.randomUUID()

  const res = NextResponse.redirect(buildDialogUrl(state))
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // se envía en la navegación top-level de vuelta desde Meta
    path: "/",
    maxAge: 600, // 10 min
  })
  return res
}
