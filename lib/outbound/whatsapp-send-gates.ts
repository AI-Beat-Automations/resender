import {
  API_KEY_RATE_LIMIT_RETRY_AFTER_SECONDS,
  allowApiKeyRequest,
} from "@/lib/auth/api-key-rate-limit"
import {
  authenticateApiKey,
  type AuthenticatedApiKey,
} from "@/lib/auth/api-keys"
import { quotaContextOf, type QuotaContext } from "@/lib/analytics/usage"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import {
  getOutboundMessageByIdempotencyKey,
  type MessageRecord,
} from "@/lib/messages/message-log"
import { type outboundLogger } from "@/lib/observability/outbound-log"
import { getBearerToken } from "@/lib/outbound/send-request"

// Los controles de acceso que comparten las rutas de envío de WhatsApp, en el
// orden en que corren: API key y rate limit, Idempotency-Key, permiso de canal,
// waitlist y cuota, y replay idempotente. `runWhatsappApiGates` es el
// subconjunto sin Idempotency-Key ni replay, para las rutas que no envían.
//
// Cada ruta sigue haciendo lo suyo después: parsear el body, resolver el
// destino, y lo que dependa del tipo de envío (la ventana de 24 h solo aplica a
// `/send`). Acá no entra nada específico de una ruta.
//
// Los descartes se loguean con el `trace` de la ruta y con los mismos `reason`
// de siempre: la sección Logs no distingue si el gate vive acá o en la ruta.

type OutboundTrace = ReturnType<typeof outboundLogger>

export type WhatsappSendGatesResult =
  | {
      ok: true
      apiKey: AuthenticatedApiKey
      periodStart: NonNullable<
        Awaited<ReturnType<typeof getTenantEntitlement>>["periodStart"]
      >
      quota: QuotaContext
      idempotencyKey: string
    }
  | { ok: false; response: Response }

export async function runWhatsappSendGates(
  request: Request,
  trace: OutboundTrace
): Promise<WhatsappSendGatesResult> {
  const reject = (response: Response) => ({ ok: false as const, response })

  // ---- 1. API key y rate limit ------------------------------------------
  const auth = await authenticateWhatsappApiRequest(request, trace)
  if (!auth.ok) return auth
  const { apiKey } = auth

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
    return reject(
      trace.drop(
        "invalid_request",
        Response.json(
          {
            error:
              "Idempotency-Key is required and must be a non-empty string of at most 200 characters",
          },
          { status: 400 }
        )
      )
    )
  }

  // ---- 3 y 4. Permiso de canal, waitlist y cuota --------------------------
  // Van **antes** del replay idempotente: un envío guardado de cuando el canal
  // estaba habilitado no puede seguir contestando 200 después de que se revocó
  // el permiso.
  const access = await checkWhatsappAccountAccess(apiKey.tenantId, trace)
  if (!access.ok) return access
  const { periodStart, quota } = access

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
    return reject(
      trace.duplicate(idempotentReplayResponse(replay), {
        subjectId: replay.id,
      })
    )
  }

  return { ok: true, apiKey, periodStart, quota, idempotencyKey }
}

export type WhatsappApiGatesResult =
  | {
      ok: true
      apiKey: AuthenticatedApiKey
    }
  | { ok: false; response: Response }

/**
 * Los controles de las rutas de WhatsApp que **no envían** (hoy,
 * `GET /templates`): API key y rate limit, permiso de canal, waitlist y cuenta
 * no restringida. Sin Idempotency-Key ni replay, que son del envío.
 *
 * La cuenta restringida (`block`) se rechaza igual que en `/send`, aunque
 * listar no consuma cuota: es el mismo criterio de «esta cuenta no opera por
 * la API». El [Plan Free] pasa, porque no lleva `block`.
 */
export async function runWhatsappApiGates(
  request: Request,
  trace: OutboundTrace
): Promise<WhatsappApiGatesResult> {
  const auth = await authenticateWhatsappApiRequest(request, trace)
  if (!auth.ok) return auth

  const access = await checkWhatsappAccountAccess(auth.apiKey.tenantId, trace)
  if (!access.ok) return access

  return { ok: true, apiKey: auth.apiKey }
}

async function authenticateWhatsappApiRequest(
  request: Request,
  trace: OutboundTrace
): Promise<WhatsappApiGatesResult> {
  const reject = (response: Response) => ({ ok: false as const, response })

  const bearer = getBearerToken(request.headers.get("authorization"))
  const apiKey = await authenticateApiKey(bearer)
  if (!apiKey) {
    return reject(
      trace.drop(
        "unauthorized",
        Response.json({ error: "unauthorized" }, { status: 401 })
      )
    )
  }
  trace.setTenant(apiKey.tenantId)

  // Antes de cualquier otro round-trip: el límite protege justamente a los
  // gates que vienen después.
  if (!(await allowApiKeyRequest(apiKey.id))) {
    return reject(
      trace.drop(
        "rate_limited",
        Response.json(
          { error: "rate_limited" },
          {
            status: 429,
            headers: {
              "retry-after": String(API_KEY_RATE_LIMIT_RETRY_AFTER_SECONDS),
            },
          }
        )
      )
    )
  }

  return { ok: true, apiKey }
}

type AccountAccessResult =
  | {
      ok: true
      periodStart: NonNullable<
        Awaited<ReturnType<typeof getTenantEntitlement>>["periodStart"]
      >
      quota: QuotaContext
    }
  | { ok: false; response: Response }

async function checkWhatsappAccountAccess(
  tenantId: string,
  trace: OutboundTrace
): Promise<AccountAccessResult> {
  const reject = (response: Response) => ({ ok: false as const, response })

  // ---- Permiso de canal (ADR 0010) ----------------------------------------
  // El `error` es genérico a propósito y no `whatsapp_not_enabled`: se escribió
  // así anticipando este canal justamente para que un cliente que ya distingue
  // el caso en Messenger o Instagram no tenga que aprender un código nuevo. Es
  // el `message` el que nombra a WhatsApp, porque la misma API key sirve para
  // los otros canales, que sí pueden estar abiertos.
  if (!(await resolveWhatsappAccess(tenantId))) {
    return reject(
      trace.drop(
        "channel_not_enabled",
        Response.json(
          {
            error: "channel_not_enabled",
            message: "whatsapp channel is not enabled",
          },
          { status: 403 }
        )
      )
    )
  }

  // ---- Waitlist y cuota ---------------------------------------------------
  if (await isUserWaitlisted(tenantId)) {
    return reject(
      trace.drop(
        "waitlisted",
        Response.json({ error: "account is on the waitlist" }, { status: 403 })
      )
    )
  }

  // ADR 0003: con la cuota del período agotada o con más conexiones de las que
  // permite el plan, la cuenta queda restringida y no envía por ninguna de sus
  // conexiones, de cualquier canal.
  const entitlement = await getTenantEntitlement(tenantId)
  const { block, periodStart } = entitlement
  // Un período sin resolver siempre viene acompañado de `block` (el módulo puro
  // es fail-closed); comprobar ambos es lo que estrecha el tipo de `periodStart`
  // hasta el incremento del contador, sin recurrir a `!`.
  if (block || !periodStart) {
    return reject(
      trace.drop(
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
      )
    )
  }

  return { ok: true, periodStart, quota: quotaContextOf(entitlement) }
}

// También la usa la ruta cuando pierde la carrera del índice único de la
// Idempotency-Key: el otro request ya guardó el envío y se contesta con ese.
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
