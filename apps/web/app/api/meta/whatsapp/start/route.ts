import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { log, type LogReason } from "@/lib/observability/logger"

import { parseWhatsappMode } from "@/features/connect-whatsapp/signup-launch"

// Entrada al Embedded Signup de WhatsApp. Es el gemelo de
// `/api/meta/instagram/start` y aplica **los mismos gates y en el mismo orden**
// —sesión → acceso al producto → suscripción activa → permiso de canal—, pero
// termina distinto, y la diferencia no es un descuido:
//
// Messenger e Instagram redirigen al diálogo de Meta desde acá. Embedded Signup
// no tiene diálogo al que navegar: es un popup que abre el JS SDK desde la
// propia pestaña y que **exige el gesto del usuario** para no ser bloqueado
// (`FB.login` tiene que llamarse de forma síncrona desde el clic). Una
// redirección no puede abrirlo. Así que esta ruta hace lo único que puede
// hacer sin el gesto: cerrar la puerta a quien no puede conectar —y decirle por
// qué— y devolver a Conexiones, con el launcher ya montado y el modo elegido.
//
// Existe igual, y no es ceremonia: es el `href` que ya usan las tarjetas
// (`CHANNEL_RECONNECT_HREF`, `resolveReconnectHref`), y sin ella el gate de
// canal se comprobaría por primera vez recién en el cierre, después de que el
// usuario hiciera el onboarding entero en Meta.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  // Los gates redirigen. Sin línea, «el botón no hace nada» y «el botón me
  // manda a facturación» se investigan a ciegas.
  const gate = (reason: LogReason, to: string) => {
    log({
      entrypoint: "route",
      action: "oauth_start",
      outcome: "dropped",
      reason,
      channel: "whatsapp",
      route: "/api/meta/whatsapp/start",
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
  // ese motivo, no «WhatsApp no está habilitado».
  if (!(await resolveWhatsappAccess(session.user.id))) {
    return gate(
      "channel_not_enabled",
      "/connections?whatsapp=error&reason=whatsapp_not_enabled"
    )
  }

  // Cuál de los dos flujos pidió el enlace. Se reenvía a la pantalla para que
  // el launcher resalte el botón correcto: reconectar un número de Coexistence
  // por el flujo estándar lo quemaría con `/register`.
  const mode = parseWhatsappMode(request.nextUrl.searchParams.get("mode"))

  log({
    entrypoint: "route",
    action: "oauth_start",
    outcome: "ok",
    channel: "whatsapp",
    route: "/api/meta/whatsapp/start",
    tenantId: session.user.id,
  })

  // El ancla es la del launcher (`id="conectar-whatsapp"`): quien llega desde
  // «Reconectar» aterriza con el botón a la vista, que es lo más cerca del
  // popup que se puede llegar sin su clic.
  return NextResponse.redirect(
    new URL(
      `/connections?whatsapp=start&mode=${mode}#conectar-whatsapp`,
      request.url
    )
  )
}
