import { NextResponse, type NextRequest } from "next/server"

import { resolveActor } from "@/lib/auth/actor"
import { getSession } from "@/lib/auth/session"
import { resolveInstagramAccess } from "@/lib/auth/channel-access"
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
// suscripción activa. El cupo **no** se mira acá aunque una cuenta de Instagram
// ya ocupe slot (ADR 0011): el chequeo vive en el callback, pegado al
// intercambio del `code`, que es el único punto donde se sabe si la cuenta que
// el usuario eligió es nueva o una reconexión de una que ya tiene activa.
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

  // Último gate y no el primero: quien no tiene sesión o no paga tiene que ver
  // ese motivo, no «Instagram no está habilitado». Cortar acá también evita
  // sembrar la cookie de `state` de un OAuth que no va a poder terminar.
  if (!(await resolveInstagramAccess(actor.tenantId))) {
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
    tenantId: actor.tenantId,
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
