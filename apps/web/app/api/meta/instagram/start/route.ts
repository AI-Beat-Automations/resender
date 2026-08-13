import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { log, type LogReason } from "@/lib/observability/logger"
import { hasActiveAccountOnChannel } from "@/lib/pages/page-registry"
import {
  buildInstagramDialogUrl,
  INSTAGRAM_STATE_COOKIE,
} from "@/lib/instagram"

// Arranca el OAuth de Instagram: genera un `state` (CSRF), lo guarda en cookie
// httpOnly y redirige al diálogo de autorización. El botón "Conectar Instagram"
// apunta acá.
//
// Mismos gates que `/api/meta/start` y en el mismo orden: sesión → acceso →
// suscripción activa → cupo. Desde el ADR 0010 una cuenta de Instagram ocupa un
// slot del plan igual que una Página de Facebook, así que el cupo también es un
// portón acá.
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

  // Gate de cupo anticipado (ADR 0010). El autoritativo vive en el callback,
  // porque solo ahí se conoce el IG ID y se puede distinguir una re-autorización
  // —que no consume slot— de una cuenta nueva.
  //
  // Acá se puede adelantar en un caso, y es exacto, no heurístico: si el tenant
  // no tiene **ninguna** cuenta de Instagram activa, el OAuth solo puede
  // terminar en cuenta nueva. Bloquear ahí le ahorra autorizar en Meta para
  // recibir un error al volver. Con una cuenta activa no se decide acá: podría
  // ser la renovación del token, que vence a los ~60 días.
  const entitlement = await getTenantEntitlement(session.user.id)
  const noSlots =
    !entitlement.limits ||
    entitlement.activeAccountCount >= entitlement.limits.maxAccounts
  if (
    noSlots &&
    !(await hasActiveAccountOnChannel(session.user.id, "instagram"))
  ) {
    return gate(
      "page_limit_reached",
      "/connections?instagram=error&reason=account_limit_reached"
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
