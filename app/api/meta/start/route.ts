import { NextResponse, type NextRequest } from "next/server"

import { resolveActor } from "@/lib/auth/actor"
import { getSession } from "@/lib/auth/session"
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

  const session = await getSession()
  if (!session?.user?.id) {
    return gate("not_authenticated", "/login")
  }

  // Una sesión huérfana vuelve a `/login` y no a `/pending`: la pantalla del
  // gate da por buena la sesión y de una credencial rota solo se sale
  // volviendo a autenticarse.
  //
  // Acceso de la persona; suscripción y permiso de canal del tenant (ADR 0020).
  // La persona de un cliente de agencia no ve precios: si la agencia no paga,
  // va a `/access`.
  const resolution = await resolveActor(session.user.id)
  if (resolution.status === "unknown_user") {
    return gate("not_authenticated", "/login")
  }
  if (resolution.status === "waitlisted") {
    return gate("waitlisted", "/pending")
  }
  if (resolution.status === "agency_unavailable") {
    return gate("waitlisted", "/access")
  }
  const { actor } = resolution

  if (!(await hasActiveSubscription(actor.tenantId))) {
    return gate(
      "no_active_subscription",
      actor.kind === "owner" ? "/billing" : "/access"
    )
  }

  log({
    entrypoint: "route",
    action: "oauth_start",
    outcome: "ok",
    channel: "messenger",
    route: "/api/meta/start",
    tenantId: actor.tenantId,
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
