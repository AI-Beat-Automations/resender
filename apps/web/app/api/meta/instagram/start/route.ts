import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveInstagramAccess } from "@/lib/auth/channel-access"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { log, type LogReason } from "@/lib/observability/logger"
import {
  buildInstagramDialogUrl,
  INSTAGRAM_STATE_COOKIE,
} from "@/lib/instagram"

// Arranca el OAuth de Instagram: genera un `state` (CSRF), lo guarda en cookie
// httpOnly y redirige al diálogo de autorización. El botón "Conectar Instagram"
// apunta acá.
//
// Mismos gates que `/api/meta/start` y en el mismo orden: sesión → acceso →
// suscripción activa. Instagram queda fuera de cuota y del cupo de páginas,
// pero el bloqueo por suscripción sí aplica, así que este portón no cambia.
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
      channel: "instagram",
      route: "/api/meta/instagram/start",
    })
    return NextResponse.redirect(new URL(to, request.url))
  }

  const session = await auth()
  if (!session?.user?.id) {
    return gate("not_authenticated", "/login")
  }

  // Una sesión huérfana vuelve a `/login` y no a `/waitlist`: esa ruta dejó de
  // ser la pantalla del gate (ADR 0007) y no permite reautenticarse.
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

  // Último gate y no el primero: quien no tiene sesión o no paga tiene que ver
  // ese motivo, no «Instagram no está habilitado». Cortar acá también evita
  // sembrar la cookie de `state` de un OAuth que no va a poder terminar.
  if (!(await resolveInstagramAccess(session.user.id))) {
    return gate(
      "channel_not_enabled",
      "/connections?instagram=error&reason=instagram_not_enabled"
    )
  }

  log({
    entrypoint: "route",
    action: "oauth_start",
    outcome: "ok",
    channel: "instagram",
    route: "/api/meta/instagram/start",
    tenantId: session.user.id,
  })

  const state = crypto.randomUUID()

  const res = NextResponse.redirect(buildInstagramDialogUrl(state))
  // Cookie propia y no la de Facebook: los dos diálogos pueden estar abiertos a
  // la vez en dos pestañas, y compartir la cookie haría que el segundo pisara
  // el `state` del primero y el callback lo rechazara por `state_mismatch`.
  res.cookies.set(INSTAGRAM_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // se envía en la navegación top-level de vuelta desde Meta
    path: "/",
    maxAge: 600, // 10 min
  })
  return res
}
