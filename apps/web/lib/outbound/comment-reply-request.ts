import { type NextRequest } from "next/server"

import { authenticateApiKey } from "@/lib/api-keys/api-keys"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  getInboundCommentByIgCommentId,
  type InstagramCommentRecord,
} from "@/lib/comments/comment-log"
import {
  getActivePageWithTokenForTenant,
  type ConnectedPageRecord,
} from "@/lib/pages/page-registry"

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

export type AuthResult =
  | { ok: true; value: CommentReplyAuth }
  | { ok: false; response: Response }

// Autenticación y gates, en el mismo orden que `/api/meta/instagram/send`.
//
// Acá tampoco va el gate de entitlement: Instagram está fuera de cuota y fuera
// del cupo de páginas por ahora, así que no hay período que resolver ni
// contador que consultar. El gate de suscripción activa, que sí aplica, está.
// Cuando Instagram entre en la facturación, este es el punto donde vuelve.
export async function authenticateCommentReplyRequest(
  request: NextRequest
): Promise<AuthResult> {
  const bearer = getBearerToken(request.headers.get("authorization"))
  const apiKey = await authenticateApiKey(bearer)
  if (!apiKey) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
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
    }
  }

  if (await isUserWaitlisted(apiKey.tenantId)) {
    return {
      ok: false,
      response: Response.json(
        { error: "account is on the waitlist" },
        { status: 403 }
      ),
    }
  }

  if (!(await hasActiveSubscription(apiKey.tenantId))) {
    return {
      ok: false,
      response: Response.json(
        { error: "no active subscription" },
        { status: 403 }
      ),
    }
  }

  return { ok: true, value: { tenantId: apiKey.tenantId, idempotencyKey } }
}

export type CommentReplyTarget = {
  page: ConnectedPageRecord
  pageAccessToken: string
  sourceComment: InstagramCommentRecord
}

export type TargetResult =
  | { ok: true; value: CommentReplyTarget }
  | { ok: false; response: Response }

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
