import { NextResponse, type NextRequest } from "next/server"

import { getSession } from "@/lib/auth/session"
import {
  CONNECT_GATE_LOG_REASON,
  CONNECT_GATE_REDIRECT,
  resolveConnectGate,
} from "@/lib/clients/connect-gate"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { log, type LogReason } from "@/lib/observability/logger"

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
// qué— y devolver a Conexiones, con el launcher ya montado y a la vista.
//
// **No lleva `?mode=`.** Lo llevó mientras hubo dos botones. Hoy hay uno solo
// —Meta ofrece los dos flujos dentro del mismo diálogo— y el modo lo deriva el
// evento de cierre, así que un modo en la URL no podría decidir nada: sería un
// parámetro que promete elegir un flujo que en realidad se elige adentro.
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

  const session = await getSession()
  if (!session?.user?.id) {
    return gate("not_authenticated", "/login")
  }

  // Los gates por actor (issue #154): un cliente conecta con la suscripción
  // del padre y nunca rebota a `/billing`. Una sesión huérfana vuelve a
  // `/login` y no a `/pending`: la pantalla del gate da por buena la sesión y
  // de una credencial rota solo se sale volviendo a autenticarse.
  const connectGate = await resolveConnectGate(session.user.id)
  if (connectGate.kind !== "ok") {
    return gate(
      CONNECT_GATE_LOG_REASON[connectGate.kind],
      CONNECT_GATE_REDIRECT[connectGate.kind]
    )
  }
  const { actor } = connectGate

  // Último gate y no el primero: quien no tiene sesión o no paga tiene que ver
  // ese motivo, no «WhatsApp no está habilitado».
  if (!(await resolveWhatsappAccess(actor.tenantId))) {
    return gate(
      "channel_not_enabled",
      "/connections?whatsapp=error&reason=whatsapp_not_enabled"
    )
  }

  log({
    entrypoint: "route",
    action: "oauth_start",
    outcome: "ok",
    channel: "whatsapp",
    route: "/api/meta/whatsapp/start",
    tenantId: actor.tenantId,
  })

  // El ancla es la del launcher (`id="conectar-whatsapp"`): quien llega desde
  // «Reconectar» aterriza con el botón a la vista, que es lo más cerca del
  // popup que se puede llegar sin su clic.
  return NextResponse.redirect(
    new URL("/connections#conectar-whatsapp", request.url)
  )
}
