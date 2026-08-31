import {
  authenticateApiKey,
  type AuthenticatedApiKey,
} from "@/lib/api-keys/api-keys"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  getOutboundMessageByIdempotencyKey,
  type MessageRecord,
} from "@/lib/messages/message-log"
import type { outboundLogger } from "@/lib/observability/outbound-log"
import { getBearerToken } from "@/lib/outbound/send-request"

// La antesala de todo envío de WhatsApp: quién pregunta, si puede, si ya lo
// preguntó antes, y recién entonces qué pidió.
//
// **Esto no es "utils".** Es una secuencia, y el orden es la mitad del valor:
// un 401 antes que un 403 para no filtrarle a un desconocido si el tenant
// existe o qué canales tiene; el permiso de canal antes del replay para que un
// envío guardado de cuando el canal estaba habilitado no siga contestando 200
// después de la revocación; el replay antes de tocar Meta o de insertar, que es
// justamente lo que hace que el reintento sea seguro; y el parseo del body al
// final, porque un cuerpo mal formado de una cuenta que no paga tiene que
// contestar lo de la cuenta y no lo del cuerpo. Reordenar cualquiera de los
// ocho cambia lo que ve el cliente, así que viven acá juntos y en orden en vez
// de repetidos por ruta.
//
// Existe porque son **dos** las rutas de envío de WhatsApp desde la ADR 0014:
// el envío libre (`/whatsapp/send`) y el de plantillas
// (`/whatsapp/templates/send`), que comparte estos ocho gates y se separa recién
// en el noveno —la ventana de 24 h, que es exactamente lo que la plantilla
// existe para saltar—. La alternativa era copiarlos, y dos copias de una
// secuencia de gates de auth y facturación no divergen de golpe: divergen en el
// arreglo que alguien aplica a una sola.
//
// **Es de WhatsApp, no neutral de canal, y a propósito.** El gate 3 resuelve el
// permiso de *este* canal y su `message` nombra a WhatsApp; volverlo genérico
// pediría inyectar el resolver y el texto, es decir pagar hoy la abstracción de
// Messenger e Instagram, que además no exigen `Idempotency-Key` y por lo tanto
// no comparten el gate 2. El día que un tercer canal quiera la misma secuencia
// se generaliza con tres casos reales a la vista y no con uno imaginado.
//
// **El trace es del que llama, no de acá.** La acción del log difiere entre las
// dos rutas y el `requestId` lo necesita la ruta después, para las líneas que
// no pasan por el trace (la invalidación del token, el contador de uso). El
// helper lo recibe ya armado, le informa el tenant apenas lo conoce y escribe
// por él los descartes: así ningún gate puede loguear una cosa y contestar
// otra.
//
// La forma del resultado es la unión discriminada que ya usa el resto del
// módulo (`OutboundSendInputResult` en `send-request.ts`): en el rechazo viaja
// una `Response` **ya armada y ya logueada**, para que la ruta no pueda
// reinterpretar un rechazo ni olvidarse de devolverlo; en el camino feliz viaja
// todo lo que la ruta necesita después y que sería un pecado recalcular.

export type OutboundSendTrace = ReturnType<typeof outboundLogger>

export type WhatsappSendGatesResult =
  | {
      ok: true
      // El tenant sale de acá: `apiKey.tenantId`. No se devuelve por separado
      // para que no haya dos formas de nombrar lo mismo.
      apiKey: AuthenticatedApiKey
      idempotencyKey: string
      // Ya estrechado a `Date`: el gate 6 es fail-closed y no deja pasar un
      // período sin resolver, así que el incremento de cuota no necesita `!`.
      periodStart: Date
      // El JSON del body, parseado y verificado como objeto. Sin interpretar:
      // cada ruta le aplica su propio parser (el neutral de canal en el envío
      // libre, el suyo en el de plantillas).
      body: object
    }
  | { ok: false; response: Response }

export async function runWhatsappSendGates({
  request,
  trace,
}: {
  request: Request
  trace: OutboundSendTrace
}): Promise<WhatsappSendGatesResult> {
  // ---- 1. API key ---------------------------------------------------------
  const bearer = getBearerToken(request.headers.get("authorization"))
  const apiKey = await authenticateApiKey(bearer)
  if (!apiKey) {
    return {
      ok: false,
      response: trace.drop(
        "unauthorized",
        Response.json({ error: "unauthorized" }, { status: 401 })
      ),
    }
  }
  trace.setTenant(apiKey.tenantId)

  // ---- 2. Idempotency-Key -------------------------------------------------
  // **Obligatoria en este canal**, a diferencia de Messenger e Instagram donde
  // es opcional. En WhatsApp el mensaje le llega a un teléfono y un duplicado se
  // ve como una molestia real del negocio hacia su cliente, no como una línea
  // repetida en un chat de escritorio. Exigirla es lo que hace que el reintento
  // —que en una API HTTP siempre va a pasar— sea seguro por defecto en vez de
  // por buena voluntad del que integra.
  const idempotencyHeader = request.headers.get("idempotency-key")
  const idempotencyKey = idempotencyHeader?.trim() ?? null
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return {
      ok: false,
      response: trace.drop(
        "invalid_request",
        Response.json(
          {
            error:
              "Idempotency-Key is required and must be a non-empty string of at most 200 characters",
          },
          { status: 400 }
        )
      ),
    }
  }

  // ---- 3. Permiso de canal (ADR 0010) -------------------------------------
  // Va **antes** del replay idempotente: un envío guardado de cuando el canal
  // estaba habilitado no puede seguir contestando 200 después de que se revocó
  // el permiso.
  //
  // El `error` es genérico a propósito y no `whatsapp_not_enabled`: se escribió
  // así anticipando este canal justamente para que un cliente que ya distingue
  // el caso en Messenger o Instagram no tenga que aprender un código nuevo. Es
  // el `message` el que nombra a WhatsApp, porque la misma API key sirve para
  // los otros canales, que sí pueden estar abiertos.
  if (!(await resolveWhatsappAccess(apiKey.tenantId))) {
    return {
      ok: false,
      response: trace.drop(
        "channel_not_enabled",
        Response.json(
          {
            error: "channel_not_enabled",
            message: "whatsapp channel is not enabled",
          },
          { status: 403 }
        )
      ),
    }
  }

  // ---- 4. Suscripción, waitlist y cuota -----------------------------------
  if (await isUserWaitlisted(apiKey.tenantId)) {
    return {
      ok: false,
      response: trace.drop(
        "waitlisted",
        Response.json({ error: "account is on the waitlist" }, { status: 403 })
      ),
    }
  }

  if (!(await hasActiveSubscription(apiKey.tenantId))) {
    return {
      ok: false,
      response: trace.drop(
        "no_active_subscription",
        Response.json({ error: "no active subscription" }, { status: 403 })
      ),
    }
  }

  // ADR 0003: con la cuota del período agotada o con más conexiones de las que
  // permite el plan, la cuenta queda restringida y no envía por ninguna de sus
  // conexiones, de cualquier canal.
  const { block, periodStart } = await getTenantEntitlement(apiKey.tenantId)
  // Un período sin resolver siempre viene acompañado de `block` (el módulo puro
  // es fail-closed); comprobar ambos es lo que estrecha el tipo de `periodStart`
  // hasta el incremento del contador, sin recurrir a `!`.
  if (block || !periodStart) {
    return {
      ok: false,
      response: trace.drop(
        "plan_restricted",
        Response.json(
          {
            error: block?.code ?? "plan_unavailable",
            message:
              block?.message ??
              "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
          },
          { status: block?.status ?? 403 }
        ),
        { errorCode: block?.code ?? "plan_unavailable" }
      ),
    }
  }

  // ---- 5. Replay idempotente ----------------------------------------------
  // No llama a Meta ni inserta, así que devolver el resultado ya almacenado es
  // lo único correcto: bloquearlo con un 402 le diría al cliente que falló un
  // mensaje que Meta ya entregó, justo en el reintento que la Idempotency-Key
  // existe para hacer seguro.
  const replay = await getOutboundMessageByIdempotencyKey(
    apiKey.tenantId,
    idempotencyKey
  )
  if (replay) {
    return {
      ok: false,
      response: trace.duplicate(idempotentReplayResponse(replay), {
        subjectId: replay.id,
      }),
    }
  }

  // ---- 5b. El body ---------------------------------------------------------
  // Sólo se verifica que sea JSON y que sea un objeto. Qué campos trae es
  // asunto del parser de cada ruta, y por eso el body sale de acá sin
  // interpretar.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return {
      ok: false,
      response: trace.drop(
        "invalid_request",
        Response.json({ error: "invalid json" }, { status: 400 })
      ),
    }
  }

  if (!body || typeof body !== "object") {
    return {
      ok: false,
      response: trace.drop(
        "invalid_request",
        Response.json({ error: "invalid body" }, { status: 400 })
      ),
    }
  }

  return { ok: true, apiKey, idempotencyKey, periodStart, body }
}

// La otra mitad del gate 5, y por eso vive acá y no en la ruta: el replay tiene
// dos caminos —el que encuentra la fila antes de enviar y el que la encuentra
// después, cuando dos requests con la misma clave corren a la vez y el índice
// único rechaza el segundo insert— y los dos le tienen que contestar al cliente
// exactamente lo mismo. Partidos entre archivos, el día que cambie el sobre
// cambia uno solo.
export function idempotentReplayResponse(message: MessageRecord) {
  return Response.json({
    ...(message.status === "failed" && message.error
      ? { error: message.error }
      : {}),
    meta: message.providerResponse,
    resender: {
      conversationId: message.conversationId,
      messageId: message.id,
      status: message.status,
      idempotentReplay: true,
    },
  })
}

// `23505` es la violación de índice único de Postgres. La carrera es real: dos
// reintentos simultáneos con la misma Idempotency-Key.
export function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}
