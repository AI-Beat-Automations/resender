import { ContractError } from "@workspace/contracts"

import type { ApiService } from "../application/service"
import { LEGACY_SEND_BODY_LIMIT_BYTES } from "../config"
import type { Entitlement } from "../domain/entitlements"
import type { MessageRecord } from "../infrastructure/db/repository"
import { log } from "../observability/logger"

export const LEGACY_SEND_PATH = "/internal/legacy/meta/send"

type LegacySendService = Pick<
  ApiService,
  | "authenticateApiKey"
  | "legacyAccessState"
  | "legacyEntitlement"
  | "sendLegacyMeta"
> & {
  repository: Pick<
    ApiService["repository"],
    | "getOutboundByIdempotency"
    | "getActivePageByProviderIdForTenant"
    | "getConversationRecord"
    | "upsertConversation"
    | "insertLegacyOutbound"
    | "incrementUsage"
    | "markPageTokenInvalid"
  >
}

type LegacySendInput = {
  pageId: string
  recipientId: string
  reply: string
  conversationId?: string
}

export async function handleLegacySend(
  request: Request,
  service: LegacySendService
): Promise<Response> {
  const startedAt = Date.now()
  const requestId = crypto.randomUUID()
  let response: Response
  try {
    response = await executeLegacySend(request, service)
  } catch {
    // Keep application failures distinct from an unavailable service binding.
    // The fixed response cannot expose credentials, body content, provider
    // URLs, access tokens, or database details.
    response = json({ error: "internal server error" }, 500)
  }
  log(response.status >= 500 ? "error" : "info", {
    entrypoint: "fetch",
    event: "legacy_send_complete",
    route: LEGACY_SEND_PATH,
    status: response.status,
    durationMs: Date.now() - startedAt,
    requestId,
    ...(response.status >= 500 ? { errorCode: "legacy_send_failed" } : {}),
  })
  return response
}

async function executeLegacySend(
  request: Request,
  service: LegacySendService
): Promise<Response> {
  let authenticated: Awaited<
    ReturnType<LegacySendService["authenticateApiKey"]>
  >
  try {
    authenticated = await service.authenticateApiKey(
      request.headers.get("authorization")
    )
  } catch (error) {
    if (error instanceof ContractError && error.status === 401) {
      return json({ error: "unauthorized" }, 401)
    }
    throw error
  }

  const idempotencyHeader = request.headers.get("idempotency-key")
  const idempotencyKey = idempotencyHeader?.trim() ?? null
  if (
    idempotencyHeader !== null &&
    (!idempotencyKey || idempotencyKey.length > 200)
  ) {
    return json(
      {
        error:
          "Idempotency-Key must be a non-empty string of at most 200 characters",
      },
      400
    )
  }

  const access = await service.legacyAccessState(authenticated.tenantId)
  if (access === "waitlisted") {
    return json({ error: "account is on the waitlist" }, 403)
  }
  if (access !== "active") {
    return json({ error: "no active subscription" }, 403)
  }

  // Compatibility contract: a stored replay precedes quota and body parsing.
  if (idempotencyKey) {
    const replay = await service.repository.getOutboundByIdempotency(
      authenticated.tenantId,
      idempotencyKey
    )
    if (replay) return replayResponse(replay)
  }

  const entitlement = await service.legacyEntitlement(authenticated.tenantId)
  const block = legacyEntitlementBlock(entitlement)
  if (block) {
    return json(
      { error: block.code, message: block.message },
      block.status
    )
  }
  const periodStart = entitlement.periodStart
  if (!periodStart) {
    return json(
      {
        error: "plan_unavailable",
        message:
          "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
      },
      403
    )
  }

  const parsedBody = await readLegacyJson(request)
  if (parsedBody.kind === "too_large") {
    return json({ error: "request body too large" }, 413)
  }
  if (parsedBody.kind === "invalid_json") {
    return json({ error: "invalid json" }, 400)
  }
  if (!parsedBody.value || typeof parsedBody.value !== "object") {
    return json({ error: "invalid body" }, 400)
  }

  const parsedInput = parseLegacySendInput(parsedBody.value)
  if (!parsedInput.ok) {
    return json({ error: parsedInput.error }, 400)
  }
  const input = parsedInput.value

  const page =
    await service.repository.getActivePageByProviderIdForTenant(
      authenticated.tenantId,
      input.pageId
    )
  if (!page) {
    return json({ error: "page is not connected for this tenant" }, 404)
  }

  let conversation = input.conversationId
    ? await service.repository.getConversationRecord(
        authenticated.tenantId,
        input.conversationId
      )
    : null
  if (input.conversationId) {
    if (
      !conversation ||
      conversation.pageId !== page.id ||
      conversation.contactId !== input.recipientId
    ) {
      return json(
        { error: "conversationId does not match pageId and recipientId" },
        400
      )
    }
  } else {
    conversation = await service.repository.upsertConversation({
      tenantId: authenticated.tenantId,
      pageId: page.id,
      contactId: input.recipientId,
      at: new Date(),
    })
  }
  if (!conversation) {
    return json({ error: "conversation not found" }, 400)
  }

  const sentAt = new Date()
  const metaResult = await service.sendLegacyMeta({
    page,
    recipientId: input.recipientId,
    text: input.reply,
  })
  if (!metaResult.ok && metaErrorCode(metaResult.data) === 190) {
    try {
      await service.repository.markPageTokenInvalid({
        tenantId: authenticated.tenantId,
        pageId: page.id,
        error:
          metaResult.error ??
          "Meta rejected the Page token. Reconnect the Page in Resender.",
      })
    } catch {
      // Best effort after Meta has already answered; never log tokens/content.
    }
  }

  let message: MessageRecord
  try {
    message = await service.repository.insertLegacyOutbound({
      tenantId: authenticated.tenantId,
      conversationId: conversation.id,
      pageId: page.id,
      contactId: input.recipientId,
      text: input.reply,
      status: metaResult.ok ? "sent" : "failed",
      providerMessageId: metaMessageId(metaResult.data),
      idempotencyKey,
      error: metaResult.reason ?? metaResult.error,
      providerResponse: metaResult.data,
      createdAt: sentAt,
    })
  } catch (error) {
    // This preserves the legacy race contract. It can replay the winner after
    // both requests reached Meta; removal requires a schema-backed cutover.
    if (idempotencyKey && databaseErrorCode(error) === "23505") {
      const existing = await service.repository.getOutboundByIdempotency(
        authenticated.tenantId,
        idempotencyKey
      )
      if (existing) return replayResponse(existing)
    }
    throw error
  }

  if (metaResult.ok) {
    try {
      await service.repository.incrementUsage(
        authenticated.tenantId,
        periodStart
      )
    } catch {
      // Meta already accepted the message, so legacy quota accounting remains
      // best effort and cannot turn the provider response into an error.
    }
  }

  return json(
    {
      ...(metaResult.ok
        ? {}
        : { error: metaResult.reason ?? metaResult.error }),
      meta: metaResult.data,
      resender: {
        conversationId: conversation.id,
        messageId: message.id,
        status: message.status,
      },
    },
    metaResult.status
  )
}

function legacyEntitlementBlock(
  entitlement: Entitlement
):
  | {
      code: "quota_exceeded" | "page_limit_exceeded" | "plan_unavailable"
      status: 402 | 403
      message: string
    }
  | undefined {
  if (!entitlement.limits) {
    return {
      code: "plan_unavailable",
      status: 403,
      message:
        "We couldn't resolve the limits of your plan. Contact support at info@resender.dev.",
    }
  }
  if (!entitlement.periodStart) {
    return {
      code: "plan_unavailable",
      status: 403,
      message:
        "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
    }
  }
  if (entitlement.activePageCount > entitlement.limits.maxPages) {
    return {
      code: "page_limit_exceeded",
      status: 403,
      message: `Your plan allows ${entitlement.limits.maxPages} connected Pages and you have ${entitlement.activePageCount}. Disconnect Pages in Connections to resume sending.`,
    }
  }
  if (entitlement.usage >= entitlement.limits.messagesPerPeriod) {
    return {
      code: "quota_exceeded",
      status: 402,
      message: `You used the ${entitlement.limits.messagesPerPeriod} messages of your plan for this billing period. Upgrade your plan to resume sending.`,
    }
  }
}

async function readLegacyJson(
  request: Request
): Promise<
  | { kind: "ok"; value: unknown }
  | { kind: "invalid_json" }
  | { kind: "too_large" }
> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > LEGACY_SEND_BODY_LIMIT_BYTES
  ) {
    return { kind: "too_large" }
  }

  const reader = request.body?.getReader()
  if (!reader) return { kind: "invalid_json" }
  const decoder = new TextDecoder()
  let size = 0
  let body = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > LEGACY_SEND_BODY_LIMIT_BYTES) {
      await reader.cancel()
      return { kind: "too_large" }
    }
    body += decoder.decode(chunk.value, { stream: true })
  }
  body += decoder.decode()
  try {
    return { kind: "ok", value: JSON.parse(body) as unknown }
  } catch {
    return { kind: "invalid_json" }
  }
}

function parseLegacySendInput(
  body: object
): { ok: true; value: LegacySendInput } | { ok: false; error: string } {
  const pageId = Reflect.get(body, "pageId")
  const recipientId = Reflect.get(body, "recipientId")
  const reply = Reflect.get(body, "reply")
  const conversationId = Reflect.get(body, "conversationId")
  if (typeof pageId !== "string" || pageId.trim().length === 0) {
    return { ok: false, error: "missing pageId" }
  }
  if (typeof recipientId !== "string" || recipientId.trim().length === 0) {
    return { ok: false, error: "missing recipientId" }
  }
  if (typeof reply !== "string" || reply.trim().length === 0) {
    return { ok: false, error: "missing reply" }
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" ||
      conversationId.trim().length === 0)
  ) {
    return { ok: false, error: "invalid conversationId" }
  }
  return {
    ok: true,
    value: {
      pageId: pageId.trim(),
      recipientId: recipientId.trim(),
      reply: reply.trim(),
      ...(typeof conversationId === "string"
        ? { conversationId: conversationId.trim() }
        : {}),
    },
  }
}

function replayResponse(message: MessageRecord): Response {
  return json({
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

function metaMessageId(data: unknown): string | null {
  const value = objectProperty(data, "message_id")
  return typeof value === "string" ? value : null
}

function metaErrorCode(data: unknown): number | null {
  const value = objectProperty(objectProperty(data, "error"), "code")
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function databaseErrorCode(error: unknown): string | null {
  const value = objectProperty(error, "code")
  return typeof value === "string" ? value : null
}

function objectProperty(value: unknown, property: string): unknown {
  if (!value || typeof value !== "object") return undefined
  return Reflect.get(value, property)
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}
