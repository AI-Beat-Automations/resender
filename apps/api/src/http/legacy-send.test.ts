import { ContractError } from "@workspace/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LEGACY_SEND_BODY_LIMIT_BYTES } from "../config"
import type {
  ConversationRecord,
  MessageRecord,
  PageRecord,
} from "../infrastructure/db/repository"
import { handleLegacySend } from "./legacy-send"

const TENANT_ID = "6b402566-9e1d-4739-bb61-81ac615a5469"
const PERIOD_START = new Date("2026-07-01T00:00:00.000Z")

describe("deprecated legacy send compatibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("maps missing and invalid API keys to the legacy 401 body", async () => {
    const service = serviceFake()
    const infoLog = vi.spyOn(console, "log").mockImplementation(() => {})
    service.authenticateApiKey.mockRejectedValue(
      new ContractError({
        code: "invalid_api_key",
        message: "The API key is invalid or revoked.",
        status: 401,
      })
    )

    const response = await handleLegacySend(request("{}"), service)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(service.legacyAccessState).not.toHaveBeenCalled()
    expect(infoLog).toHaveBeenCalledOnce()
    const record = infoLog.mock.calls[0]?.[0]
    expect(record).toMatchObject({
      worker: "api",
      entrypoint: "fetch",
      event: "legacy_send_complete",
      route: "/internal/legacy/meta/send",
      status: 401,
    })
    expect(Object.keys(record).sort()).toEqual(
      [
        "durationMs",
        "entrypoint",
        "event",
        "requestId",
        "route",
        "status",
        "worker",
      ].sort()
    )
    expect(JSON.stringify(record)).not.toMatch(
      /test-key|authorization|access_token|sensitive/u
    )
  })

  it.each([" ", "x".repeat(201)])(
    "rejects invalid Idempotency-Key %j before access gates",
    async (value) => {
      const service = serviceFake()
      const response = await handleLegacySend(
        request("{}", { "Idempotency-Key": value }),
        service
      )
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error:
          "Idempotency-Key must be a non-empty string of at most 200 characters",
      })
      expect(service.legacyAccessState).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      "waitlisted",
      "waitlisted",
      { error: "account is on the waitlist" },
    ],
    [
      "inactive",
      "inactive",
      { error: "no active subscription" },
    ],
  ] as const)("preserves the %s access response", async (_name, state, body) => {
    const service = serviceFake()
    service.legacyAccessState.mockResolvedValue(state)
    const response = await handleLegacySend(request("{}"), service)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
    expect(service.legacyEntitlement).not.toHaveBeenCalled()
  })

  it("replays before quota and body parsing without a provider side effect", async () => {
    const service = serviceFake()
    service.repository.getOutboundByIdempotency.mockResolvedValue(
      messageRecord({ status: "sent", providerResponse: { message_id: "mid" } })
    )

    const response = await handleLegacySend(
      request("not json", { "Idempotency-Key": " replay-1 " }),
      service
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      meta: { message_id: "mid" },
      resender: { idempotentReplay: true, status: "sent" },
    })
    expect(service.legacyEntitlement).not.toHaveBeenCalled()
    expect(service.sendLegacyMeta).not.toHaveBeenCalled()
    expect(service.repository.incrementUsage).not.toHaveBeenCalled()
  })

  it("preserves page-limit precedence over quota and parses no body", async () => {
    const service = serviceFake()
    service.legacyEntitlement.mockResolvedValue({
      priceLookupKey: "starter_monthly",
      periodStart: PERIOD_START,
      usage: 50_000,
      activePageCount: 3,
      limits: { messagesPerPeriod: 50_000, maxPages: 2 },
      blockCode: "page_limit_exceeded",
    })

    const response = await handleLegacySend(request("not json"), service)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "page_limit_exceeded",
      message:
        "Your plan allows 2 connected Pages and you have 3. Disconnect Pages in Connections to resume sending.",
    })
    expect(service.repository.getActivePageByProviderIdForTenant).not.toHaveBeenCalled()
  })

  it("preserves optional idempotency, raw Meta status/body and success quota", async () => {
    const service = serviceFake()
    service.sendLegacyMeta.mockResolvedValue({
      ok: true,
      status: 201,
      data: { recipient_id: "psid", message_id: "meta-42", extra: true },
      error: null,
      reason: null,
    })

    const response = await handleLegacySend(
      request(
        JSON.stringify({
          pageId: "provider-page",
          recipientId: " psid ",
          reply: " hello ",
        })
      ),
      service
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      meta: { recipient_id: "psid", message_id: "meta-42", extra: true },
      resender: {
        conversationId: "conversation-1",
        messageId: "message-1",
        status: "sent",
      },
    })
    expect(service.repository.getOutboundByIdempotency).not.toHaveBeenCalled()
    expect(service.repository.getActivePageByProviderIdForTenant).toHaveBeenCalledWith(
      TENANT_ID,
      "provider-page"
    )
    expect(service.sendLegacyMeta).toHaveBeenCalledWith({
      page: PAGE,
      recipientId: "psid",
      text: "hello",
    })
    expect(service.repository.insertLegacyOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: null,
        status: "sent",
        providerMessageId: "meta-42",
        providerResponse: {
          recipient_id: "psid",
          message_id: "meta-42",
          extra: true,
        },
      })
    )
    expect(service.repository.incrementUsage).toHaveBeenCalledWith(
      TENANT_ID,
      PERIOD_START
    )
  })

  it.each([
    ["invalid json", "{", { error: "invalid json" }],
    ["null body", "null", { error: "invalid body" }],
    ["non-object body", "[]", { error: "missing pageId" }],
    ["missing pageId", '{"recipientId":"p","reply":"r"}', { error: "missing pageId" }],
    ["missing recipientId", '{"pageId":"p","reply":"r"}', { error: "missing recipientId" }],
    ["missing reply", '{"pageId":"p","recipientId":"r"}', { error: "missing reply" }],
    [
      "invalid conversationId",
      '{"pageId":"p","recipientId":"r","reply":"x","conversationId":" "}',
      { error: "invalid conversationId" },
    ],
  ])("preserves the %s validation body", async (_name, raw, expected) => {
    const service = serviceFake()
    const response = await handleLegacySend(request(raw), service)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expected)
    expect(service.sendLegacyMeta).not.toHaveBeenCalled()
  })

  it("returns the legacy tenant-scoped provider page 404", async () => {
    const service = serviceFake()
    service.repository.getActivePageByProviderIdForTenant.mockResolvedValue(
      null
    )
    const response = await handleLegacySend(
      request(validBody()),
      service
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "page is not connected for this tenant",
    })
  })

  it("rejects a conversation that does not match provider page and recipient", async () => {
    const service = serviceFake()
    service.repository.getConversationRecord.mockResolvedValue({
      ...CONVERSATION,
      contactId: "another-contact",
    })
    const response = await handleLegacySend(
      request(
        JSON.stringify({
          pageId: "provider-page",
          recipientId: "psid",
          reply: "hello",
          conversationId: CONVERSATION.id,
        })
      ),
      service
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "conversationId does not match pageId and recipientId",
    })
    expect(service.sendLegacyMeta).not.toHaveBeenCalled()
  })

  it("persists a provider failure, returns its raw status and consumes no quota", async () => {
    const service = serviceFake()
    const rawProvider = {
      error: { code: 10, error_subcode: 2018278, message: "raw Meta error" },
    }
    const reason =
      "Messenger's 24-hour window is closed: this contact hasn't messaged the Page in the last 24 hours, so Meta rejects new messages until they write again."
    service.sendLegacyMeta.mockResolvedValue({
      ok: false,
      status: 400,
      data: rawProvider,
      error: "raw Meta error",
      reason,
    })
    service.repository.insertLegacyOutbound.mockResolvedValue(
      messageRecord({ status: "failed", error: reason })
    )
    const response = await handleLegacySend(
      request(
        JSON.stringify({
          pageId: "provider-page",
          recipientId: "psid",
          reply: "sensitive message",
        })
      ),
      service
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: reason,
      meta: rawProvider,
      resender: {
        conversationId: "conversation-1",
        messageId: "message-1",
        status: "failed",
      },
    })
    expect(service.repository.insertLegacyOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: reason,
        providerResponse: rawProvider,
      })
    )
    expect(service.repository.incrementUsage).not.toHaveBeenCalled()
  })

  it("marks an expired Page token best effort and preserves the Meta response", async () => {
    const service = serviceFake()
    service.sendLegacyMeta.mockResolvedValue({
      ok: false,
      status: 400,
      data: { error: { code: "190", message: "expired" } },
      error: "expired",
      reason:
        "The Page access token expired or was revoked. Reconnect the Page in Resender.",
    })
    service.repository.insertLegacyOutbound.mockResolvedValue(
      messageRecord({ status: "failed" })
    )
    service.repository.markPageTokenInvalid.mockRejectedValue(
      new Error("database details")
    )
    const response = await handleLegacySend(request(validBody()), service)
    expect(response.status).toBe(400)
    expect(service.repository.markPageTokenInvalid).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      pageId: PAGE.id,
      error: "expired",
    })
    expect(service.repository.insertLegacyOutbound).toHaveBeenCalledOnce()
    expect(service.repository.incrementUsage).not.toHaveBeenCalled()
  })

  it("bounds the body before parsing or invoking Meta", async () => {
    const service = serviceFake()
    const response = await handleLegacySend(
      request(`"${"x".repeat(LEGACY_SEND_BODY_LIMIT_BYTES)}"`),
      service
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: "request body too large",
    })
    expect(service.repository.getActivePageByProviderIdForTenant).not.toHaveBeenCalled()
    expect(service.sendLegacyMeta).not.toHaveBeenCalled()
  })

  it("returns a fixed 500 without leaking repository errors", async () => {
    const service = serviceFake()
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    service.legacyAccessState.mockRejectedValue(
      new Error("DATABASE_URL=SECRET body=sensitive")
    )
    const response = await handleLegacySend(
      request('{"reply":"sensitive"}'),
      service
    )

    expect(response.status).toBe(500)
    const serialized = await response.text()
    expect(serialized).toBe('{"error":"internal server error"}')
    expect(serialized).not.toMatch(/SECRET|sensitive|DATABASE_URL/u)
    expect(errorLog).toHaveBeenCalledOnce()
    const logged = JSON.stringify(
      errorLog.mock.calls[0]?.[0]
    )
    expect(logged).toContain('"event":"legacy_send_complete"')
    expect(logged).toContain('"status":500')
    expect(logged).not.toMatch(
      /SECRET|sensitive|DATABASE_URL|authorization|access_token/u
    )
  })

  it("returns the stored winner after the documented legacy uniqueness race", async () => {
    const service = serviceFake()
    const winner = messageRecord({
      status: "sent",
      providerResponse: { message_id: "winner" },
    })
    service.repository.insertLegacyOutbound.mockRejectedValue({ code: "23505" })
    service.repository.getOutboundByIdempotency
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)

    const response = await handleLegacySend(
      request(
        JSON.stringify({
          pageId: "provider-page",
          recipientId: "psid",
          reply: "hello",
        }),
        { "Idempotency-Key": "same-key" }
      ),
      service
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      meta: { message_id: "winner" },
      resender: { idempotentReplay: true },
    })
    expect(service.sendLegacyMeta).toHaveBeenCalledOnce()
    expect(service.repository.incrementUsage).not.toHaveBeenCalled()
  })
})

function serviceFake() {
  return {
    authenticateApiKey: vi
      .fn()
      .mockResolvedValue({ tenantId: TENANT_ID, apiKeyId: "key-1" }),
    legacyAccessState: vi.fn().mockResolvedValue("active" as const),
    legacyEntitlement: vi.fn().mockResolvedValue({
      priceLookupKey: "starter_monthly" as const,
      periodStart: PERIOD_START,
      usage: 0,
      activePageCount: 1,
      limits: { messagesPerPeriod: 50_000, maxPages: 2 },
      blockCode: null,
    }),
    sendLegacyMeta: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: { message_id: "meta-1" },
      error: null,
      reason: null,
    }),
    repository: {
      getOutboundByIdempotency: vi.fn().mockResolvedValue(null),
      getActivePageByProviderIdForTenant: vi.fn().mockResolvedValue(PAGE),
      getConversationRecord: vi.fn().mockResolvedValue(CONVERSATION),
      upsertConversation: vi.fn().mockResolvedValue(CONVERSATION),
      insertLegacyOutbound: vi.fn().mockResolvedValue(messageRecord()),
      incrementUsage: vi.fn().mockResolvedValue(1),
      markPageTokenInvalid: vi.fn().mockResolvedValue(undefined),
    },
  }
}

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://backend.internal/internal/legacy/meta/send", {
    method: "POST",
    headers: {
      authorization: "Bearer pk_live_test-key",
      "content-type": "application/json",
      ...headers,
    },
    body,
  })
}

function validBody(): string {
  return JSON.stringify({
    pageId: "provider-page",
    recipientId: "psid",
    reply: "hello",
  })
}

const PAGE: PageRecord = {
  id: "page-1",
  tenantId: TENANT_ID,
  providerPageId: "provider-page",
  name: "Page",
  status: "active",
  tokenStatus: "valid",
  tokenError: null,
  tokenErrorAt: null,
  webhookUrl: null,
  pageAccessTokenEncrypted: "encrypted",
  webhookSigningSecretEncrypted: null,
  connectedAt: new Date("2026-07-01T00:00:00.000Z"),
  disconnectedAt: null,
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
}

const CONVERSATION: ConversationRecord = {
  id: "conversation-1",
  tenantId: TENANT_ID,
  pageId: PAGE.id,
  contactId: "psid",
  contactName: null,
  lastMessageAt: new Date("2026-07-30T00:00:00.000Z"),
}

function messageRecord(
  overrides: Partial<MessageRecord> = {}
): MessageRecord {
  return {
    id: "message-1",
    tenantId: TENANT_ID,
    conversationId: CONVERSATION.id,
    pageId: PAGE.id,
    contactId: "psid",
    direction: "outbound",
    status: "sent",
    text: "hello",
    providerMessageId: "meta-1",
    error: null,
    providerResponse: { message_id: "meta-1" },
    idempotencyKey: "same-key",
    idempotencyFingerprint: null,
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
    ...overrides,
  }
}
