import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
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
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Una sesión huérfana vuelve a `/login` y no a `/waitlist`: esa ruta dejó de
  // ser la pantalla del gate (ADR 0007) y no permite reautenticarse.
  const access = await resolveProductAccess(session.user.id)
  if (access === "unknown_user") {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  if (access === "waitlisted") {
    return NextResponse.redirect(new URL("/waitlist", request.url))
  }

  if (!(await hasActiveSubscription(session.user.id))) {
    return NextResponse.redirect(new URL("/billing", request.url))
  }

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
