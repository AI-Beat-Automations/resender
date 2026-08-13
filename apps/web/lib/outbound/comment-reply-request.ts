import { type NextRequest } from "next/server"

import { authenticateApiKey } from "@/lib/api-keys/api-keys"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  getInboundCommentByIgCommentId,
  type InstagramCommentRecord,
} from "@/lib/comments/comment-log"
import {
  getActivePageWithTokenForTenant,
  type ConnectedPageRecord,
} from "@/lib/pages/page-registry"

import type { LogReason } from "@/lib/observability/logger"

import type { CommentReplyInput } from "./send-request"
import { getBearerToken } from "./send-request"

// Las dos rutas de respuesta a comentarios —la pública y la privada— comparten
// todo lo que pasa antes de llamar a Meta y nada de lo que pasa después. Acá
// vive ese antes, partido en dos porque en el medio va lo que sí difiere: cada
// ruta busca su replay idempotente en su propia tabla y valida el largo con su
// propio límite (2200 caracteres el comentario, 1000 bytes el DM).

export type CommentReplyAuth = {
  tenantId: string
  idempotencyKey: string | null
}

// El fallo lleva su motivo del catálogo, pero el módulo **no loguea**: no sabe
// si está sirviendo a `comment_reply` o a `comment_private_reply`, y adivinar
// produciría una `action` equivocada. La ruta, que sí lo sabe, escribe la línea.
export type AuthResult =
  | { ok: true; value: CommentReplyAuth }
  | { ok: false; response: Response; reason: LogReason }

// Autenticación y gates, en el mismo orden que `/api/meta/instagram/send`.
//
// El gate de entitlement **no va acá**, aunque sea lo compartido y este sea el
// módulo de lo compartido: las dos rutas resuelven su replay idempotente
// *después* de llamar a esta función, y el gate de cuota tiene que ir *después*
// del replay (ver `assertCommentReplyEntitlement`). Metido acá quedaría antes, y
// un 402 sobre un replay le diría al cliente que falló un mensaje que Meta ya
// entregó, justo en la tormenta de reintentos que la Idempotency-Key existe
// para hacer segura.
export async function authenticateCommentReplyRequest(
  request: NextRequest
): Promise<AuthResult> {
  const bearer = getBearerToken(request.headers.get("authorization"))
  const apiKey = await authenticateApiKey(bearer)
  if (!apiKey) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
      reason: "unauthorized",
    }
  }

  const idempotencyHeader = request.headers.get("idempotency-key")
  const idempotencyKey = idempotencyHeader?.trim() ?? null
  if (
    idempotencyHeader !== null &&
    (!idempotencyKey || idempotencyKey.length > 200)
  ) {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            "Idempotency-Key must be a non-empty string of at most 200 characters",
        },
        { status: 400 }
      ),
      reason: "invalid_request",
    }
  }

  if (await isUserWaitlisted(apiKey.tenantId)) {
    return {
      ok: false,
      response: Response.json(
        { error: "account is on the waitlist" },
        { status: 403 }
      ),
      reason: "waitlisted",
    }
  }

  if (!(await hasActiveSubscription(apiKey.tenantId))) {
    return {
      ok: false,
      response: Response.json(
        { error: "no active subscription" },
        { status: 403 }
      ),
      reason: "no_active_subscription",
    }
  }

  return { ok: true, value: { tenantId: apiKey.tenantId, idempotencyKey } }
}

export type EntitlementResult =
  | { ok: true; periodStart: Date }
  | { ok: false; response: Response; reason: LogReason; errorCode: string }

// Gate de cuota y cupo (ADR 0003 + 0010), separado de la autenticación por una
// razón de **orden**, no de estilo: cada ruta lo llama después de resolver su
// propio replay idempotente, en su propia tabla. Ver el comentario de
// `authenticateCommentReplyRequest`.
//
// Una implementación, dos call sites: la lógica sigue sin duplicarse.
export async function assertCommentReplyEntitlement(
  tenantId: string
): Promise<EntitlementResult> {
  const { block, periodStart } = await getTenantEntitlement(tenantId)
  // Un período sin resolver siempre viene acompañado de `block` (el módulo puro
  // es fail-closed); comprobar ambos estrecha el tipo de `periodStart` hasta el
  // incremento del contador, sin recurrir a `!`.
  if (block || !periodStart) {
    const errorCode = block?.code ?? "plan_unavailable"
    return {
      ok: false,
      response: Response.json(
        {
          error: errorCode,
          message:
            block?.message ??
            "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
        },
        { status: block?.status ?? 403 }
      ),
      reason: "plan_restricted",
      errorCode,
    }
  }

  return { ok: true, periodStart }
}

export type CommentReplyTarget = {
  page: ConnectedPageRecord
  pageAccessToken: string
  sourceComment: InstagramCommentRecord
}

export type TargetResult =
  | { ok: true; value: CommentReplyTarget }
  | { ok: false; response: Response; reason: LogReason }

// Resuelve la cuenta que responde y el comentario que se está contestando.
//
// Se exige que el comentario esté en `instagram_comments`: es de ahí que salen
// la publicación a la que pertenece y el IGSID de quien comentó, que Meta no
// devuelve y que la fila saliente necesita. En la práctica siempre está, porque
// el tenant conoce el `commentId` justamente porque Resender se lo mandó. Un
// comentario que nunca entró —de antes de conectar la cuenta, o de un período
// sin suscripción— da 404 y el mensaje lo dice, en vez de fallar más adelante
// con un error de Meta que no señala la causa.
export async function resolveCommentReplyTarget(input: {
  tenantId: string
  value: CommentReplyInput
}): Promise<TargetResult> {
  const connectedPage = await getActivePageWithTokenForTenant(
    input.tenantId,
    input.value.pageId,
    "instagram"
  )
  if (!connectedPage) {
    return {
      ok: false,
      response: Response.json(
        { error: "Instagram account is not connected for this tenant" },
        { status: 404 }
      ),
      reason: "page_not_connected",
    }
  }

  const sourceComment = await getInboundCommentByIgCommentId({
    tenantId: input.tenantId,
    connectedPageId: connectedPage.page.id,
    igCommentId: input.value.commentId,
  })
  if (!sourceComment) {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            "comment not found for this account: Resender can only reply to comments it received through the webhook",
        },
        { status: 404 }
      ),
      reason: "comment_not_found",
    }
  }

  return {
    ok: true,
    value: {
      page: connectedPage.page,
      pageAccessToken: connectedPage.pageAccessToken,
      sourceComment,
    },
  }
}

export function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}
