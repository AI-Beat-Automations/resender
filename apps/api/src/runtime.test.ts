import { env, exports as workerExports } from "cloudflare:workers"
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
  waitOnExecutionContext,
} from "cloudflare:test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContractError } from "@workspace/contracts"

import { ApiService } from "./application/service"
import { encodeCursor } from "./domain/cursor"
import { hmacHex } from "./infrastructure/crypto/secrets"
import { sqlTransport } from "./infrastructure/db/client"
import worker from "./index"
import {
  SqlRepository,
  type PageRecord,
  type SubscriptionRecord,
} from "./infrastructure/db/repository"
import {
  createStripeClient,
  stripeTransport,
} from "./infrastructure/stripe/client"
import { RuntimeDatabase } from "./runtime-database.test-helper"
import wranglerConfig from "../wrangler.jsonc?raw"

// Entitlements are evaluated against the wall clock, so the fixture billing
// window tracks now. A window pinned to fixed calendar dates expires and turns
// every entitlement into `plan_unavailable`.
const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_START = new Date(Date.now() - 15 * DAY_MS)
const PERIOD_END = new Date(Date.now() + 15 * DAY_MS)

describe("Worker runtime entrypoints", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("serves the default fetch handler through the configured main Worker", async () => {
    const response = await workerExports.default.fetch(
      "https://api.resender.dev/healthz"
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok", service: "api" })
  })

  it("configures retryable DLQ consumers in both environments", () => {
    const retries = [
      ...wranglerConfig.matchAll(
        /"queue":\s*"webhook-deliveries(?:-staging)?-dlq"[\s\S]*?"max_retries":\s*(\d+)/gu
      ),
    ].map((match) => Number(match[1]))
    expect(retries).toEqual([5, 5])
    expect(retries).not.toContain(0)
  })

  it.each([
    ["account_waitlisted", true, "active"],
    ["subscription_required", false, "past_due"],
  ] as const)(
    "enforces the %s gate through the default fetch handler",
    async (code, waitlisted, subscriptionStatus) => {
      vi.spyOn(SqlRepository.prototype, "getApiKeyByHash").mockResolvedValue({
        id: "key_1",
        tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
        secretHash: "hash",
        status: "active",
        waitlisted,
      })
      vi.spyOn(SqlRepository.prototype, "touchApiKey").mockResolvedValue(true)
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue({
        id: "6b402566-9e1d-4739-bb61-81ac615a5469",
        email: "user@example.com",
        passwordHash: "hash",
        waitlisted,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      })
      vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue({
        tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
        stripeSubscriptionId: "sub_1",
        status: subscriptionStatus,
        priceLookupKey: "starter_monthly",
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
        cancelAtPeriodEnd: false,
        lastStripeEventAt: new Date("2026-07-01T00:00:00.000Z"),
      })

      const response = await workerExports.default.fetch(
        "https://api.resender.dev/v1/me",
        { headers: { authorization: "Bearer pk_live_runtime-test" } }
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code } })
    }
  )

  it("invokes the named WebAppApi RPC entrypoint", async () => {
    vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(null)
    await expect(
      workerExports.WebAppApi.getProductAccess({
        userId: "6b402566-9e1d-4739-bb61-81ac615a5469",
      })
    ).resolves.toEqual({
      userExists: false,
      waitlisted: false,
      subscriptionActive: false,
      destination: "billing",
    })
  })

  it("runs the default primary Queue handler with a real MessageBatch", async () => {
    vi.spyOn(SqlRepository.prototype, "claimJob").mockResolvedValue(null)
    vi.spyOn(SqlRepository.prototype, "getJob").mockResolvedValue({
      id: "d743db7b-d4b8-4911-bf01-c639816856fc",
      eventId: "evt_1",
      tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
      messageId: "ef55c94e-b861-4d19-9f9b-b5689028de80",
      webhookUrl: "https://example.com/webhook",
      payload: {},
      status: "succeeded",
      attemptCount: 1,
      recoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      signingSecretEncrypted: null,
    })
    const batch = createMessageBatch("webhook-deliveries", [
      {
        id: "queue_message_1",
        timestamp: new Date("2026-07-29T18:00:00.000Z"),
        attempts: 1,
        body: {
          jobId: "d743db7b-d4b8-4911-bf01-c639816856fc",
          messageId: "ef55c94e-b861-4d19-9f9b-b5689028de80",
        },
      },
    ])
    const context = createExecutionContext()
    await worker.queue?.(batch, env)
    const result = await getQueueResult(batch, context)
    expect(result.explicitAcks).toEqual(["queue_message_1"])
    expect(result.retryMessages).toEqual([])
  })

  it("runs the default DLQ handler and persists dead before acknowledging", async () => {
    const markDead = vi
      .spyOn(SqlRepository.prototype, "markJobDead")
      .mockResolvedValue()
    const batch = createMessageBatch("webhook-deliveries-dlq", [
      {
        id: "dlq_message_1",
        timestamp: new Date("2026-07-29T18:00:00.000Z"),
        attempts: 1,
        body: {
          jobId: "d743db7b-d4b8-4911-bf01-c639816856fc",
          messageId: "ef55c94e-b861-4d19-9f9b-b5689028de80",
        },
      },
    ])
    const context = createExecutionContext()
    await worker.queue?.(batch, env)
    const result = await getQueueResult(batch, context)
    expect(markDead).toHaveBeenCalledOnce()
    expect(result.explicitAcks).toEqual(["dlq_message_1"])
  })

  it("runs scheduled recovery through the real repository and Queue binding", async () => {
    const database = runtimeDatabase()
    database.jobs.push({
      id: JOB_ID,
      eventId: "evt_recovery",
      tenantId: ACTOR.userId,
      messageId: MESSAGE_ID,
      webhookUrl: "https://example.com/webhook",
      payload: { type: "message.received" },
      status: "pending",
      attemptCount: 0,
      recoverAfter: new Date("2020-01-01T00:00:00.000Z"),
      signingSecretEncrypted: "encrypted",
    })
    vi.spyOn(sqlTransport, "create").mockReturnValue(database.sql)
    const queueSend = vi
      .spyOn(env.WEBHOOK_DELIVERIES, "send")
      .mockResolvedValue(queueSendResult())
    const controller = createScheduledController({
      scheduledTime: new Date("2026-07-29T18:00:00.000Z"),
      cron: "*/5 * * * *",
    })
    const context = createExecutionContext()
    await worker.scheduled?.(controller, env)
    await waitOnExecutionContext(context)
    expect(queueSend).toHaveBeenCalledWith({
      jobId: JOB_ID,
      messageId: MESSAGE_ID,
    })
    expect(database.jobs[0]?.recoverAfter.getTime()).toBeGreaterThan(Date.now())
  })

  it.each([
    [
      "authentication",
      "authenticateCredentials",
      {
        code: "validation_error",
        status: 400,
        message: "Credentials are invalid.",
      },
      () =>
        workerExports.WebAppApi.authenticateCredentials({
          email: "person@example.com",
          password: "correct horse battery staple",
        }),
    ],
    [
      "Meta",
      "listAuthorizedMetaPages",
      {
        code: "provider_unavailable",
        status: 502,
        message: "Meta is temporarily unavailable.",
      },
      () => workerExports.WebAppApi.listAuthorizedMetaPages(ACTOR),
    ],
    [
      "Stripe",
      "createCheckoutSession",
      {
        code: "provider_unavailable",
        status: 502,
        message: "Stripe is temporarily unavailable.",
      },
      () =>
        workerExports.WebAppApi.createCheckoutSession(ACTOR, {
          priceLookupKey: "starter_monthly",
          returnUrl: "https://app.resender.dev",
        }),
    ],
  ] as const)(
    "preserves %s ContractError fields across the Workers RPC boundary",
    async (_name, method, expected, invoke) => {
      const details = [
        {
          path: method,
          message: "Boundary detail",
        },
      ]
      vi.spyOn(ApiService.prototype, method).mockImplementation(async () => {
        throw new ContractError({
          ...expected,
          details,
        })
      })

      const error = await captureError(invoke())
      expect(error).toMatchObject({
        ...expected,
        details,
      })
    }
  )

  it("returns the approved cursor validation envelope through default.fetch", async () => {
    mockActiveTenant()
    const cursor = encodeCursor({
      at: "2026-07-29T18:00:00.000Z",
      id: "not-a-uuid",
    })
    const response = await workerExports.default.fetch(
      `https://api.resender.dev/v1/messages?limit=25&cursor=${encodeURIComponent(cursor)}`,
      { headers: { authorization: "Bearer pk_live_runtime-test" } }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: "validation_error",
        message: "The cursor is invalid.",
        details: [{ path: "cursor", message: "Invalid cursor" }],
      },
    })
  })

  it("accepts a signed Meta callback and durably hands off both the insert and its deduplicated retry", async () => {
    const database = runtimeDatabase()
    vi.spyOn(sqlTransport, "create").mockReturnValue(database.sql)
    const queueSend = vi
      .spyOn(env.WEBHOOK_DELIVERIES, "send")
      .mockResolvedValue(queueSendResult())

    const first = await signedMetaCallback("mid.runtime")
    const duplicate = await signedMetaCallback("mid.runtime")

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, accepted: 1 })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual({ ok: true, accepted: 0 })
    expect(database.messages).toHaveLength(1)
    expect(database.jobs).toHaveLength(1)
    expect(database.usage).toBe(1)
    expect(queueSend).toHaveBeenCalledTimes(2)

    queueSend.mockRejectedValueOnce(new Error("Queue unavailable"))
    const failedHandoff = await signedMetaCallback("mid.queue-failure")
    expect(failedHandoff.status).toBe(500)
    expect(database.messages).toHaveLength(2)
    expect(database.jobs).toHaveLength(2)
    expect(database.usage).toBe(2)

    const retriedHandoff = await signedMetaCallback("mid.queue-failure")
    expect(retriedHandoff.status).toBe(200)
    expect(await retriedHandoff.json()).toEqual({ ok: true, accepted: 0 })
    expect(database.messages).toHaveLength(2)
    expect(database.jobs).toHaveLength(2)
    expect(database.usage).toBe(2)
    expect(database.inboundInsertStatements).toBe(4)
    expect(queueSend).toHaveBeenCalledTimes(4)
    expect(queueSend).toHaveBeenLastCalledWith({
      jobId: database.jobs[1]?.id,
      messageId: database.messages[1]?.id,
    })
  })

  it("accepts signed Stripe callbacks while preserving canonical subscription ordering under duplicates", async () => {
    const database = new RuntimeDatabase(runtimePage(), runtimeUser(), null)
    vi.spyOn(sqlTransport, "create").mockReturnValue(database.sql)
    const signatureClient = createStripeClient(String(env.STRIPE_SECRET_KEY))
    const providerClient = createStripeClient(String(env.STRIPE_SECRET_KEY))
    const retrieve = vi
      .spyOn(providerClient.subscriptions, "retrieve")
      .mockRejectedValue(new Error("unexpected cleanup"))
    const cancel = vi
      .spyOn(providerClient.subscriptions, "cancel")
      .mockRejectedValue(new Error("unexpected cleanup"))
    const refund = vi
      .spyOn(providerClient.refunds, "create")
      .mockRejectedValue(new Error("unexpected cleanup"))
    vi.spyOn(stripeTransport, "create").mockReturnValue(providerClient)
    const sendEvent = async (event: Record<string, unknown>) => {
      const payload = JSON.stringify(event)
      const signature =
        await signatureClient.webhooks.generateTestHeaderStringAsync({
          payload,
          secret: String(env.STRIPE_WEBHOOK_SECRET),
          timestamp: Math.floor(Date.now() / 1000),
        })
      return workerExports.default.fetch(
        "https://api.resender.dev/webhooks/stripe",
        {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: payload,
        }
      )
    }
    const current = stripeSubscriptionEvent({
      eventId: "evt_current",
      subscriptionId: "sub_current",
      status: "active",
      created: 1_785_348_300,
    })
    const obsolete = stripeSubscriptionEvent({
      eventId: "evt_obsolete",
      subscriptionId: "sub_obsolete",
      status: "canceled",
      created: 1_785_348_000,
    })

    const applied = await sendEvent(current)
    const afterApplied = database.subscription
      ? { ...database.subscription }
      : null
    const replayed = await sendEvent(current)
    const afterReplay = database.subscription
      ? { ...database.subscription }
      : null
    const obsoleteResponse = await sendEvent(obsolete)

    expect(
      [applied, replayed, obsoleteResponse].map((response) => response.status)
    ).toEqual([200, 200, 200])
    await expect(
      Promise.all(
        [applied, replayed, obsoleteResponse].map((response) => response.json())
      )
    ).resolves.toEqual([
      { received: true },
      { received: true },
      { received: true },
    ])
    expect(afterReplay).toEqual(afterApplied)
    expect(database.subscriptionWrites).toBe(2)
    expect(database.subscription).toMatchObject({
      stripeSubscriptionId: "sub_current",
      status: "active",
      lastStripeEventAt: new Date(1_785_348_300_000),
    })
    expect(retrieve).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
  })

  it.each([
    ["/webhooks/meta", "x-hub-signature-256"],
    ["/webhooks/stripe", "stripe-signature"],
  ])(
    "normalizes invalid signatures in the default %s handler",
    async (path, header) => {
      const response = await workerExports.default.fetch(
        `https://api.resender.dev${path}`,
        {
          method: "POST",
          headers: { [header]: "invalid" },
          body: "{}",
        }
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_signature" },
      })
    }
  )
})

const ACTOR = {
  userId: "6b402566-9e1d-4739-bb61-81ac615a5469",
}

const JOB_ID = "d743db7b-d4b8-4911-bf01-c639816856fc"
const MESSAGE_ID = "ef55c94e-b861-4d19-9f9b-b5689028de80"

function mockActiveTenant(): void {
  vi.spyOn(SqlRepository.prototype, "getApiKeyByHash").mockResolvedValue({
    id: "key_1",
    tenantId: ACTOR.userId,
    secretHash: "hash",
    status: "active",
    waitlisted: false,
  })
  vi.spyOn(SqlRepository.prototype, "touchApiKey").mockResolvedValue(true)
  vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue({
    id: ACTOR.userId,
    email: "person@example.com",
    passwordHash: "hash",
    waitlisted: false,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  })
  vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue({
    tenantId: ACTOR.userId,
    stripeSubscriptionId: "sub_1",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    lastStripeEventAt: new Date("2026-07-01T00:00:00.000Z"),
  })
}

async function captureError(
  promise: Promise<unknown>
): Promise<Record<string, unknown>> {
  try {
    await promise
  } catch (error) {
    return error as Record<string, unknown>
  }
  throw new Error("Expected operation to reject")
}

function runtimePage(): PageRecord {
  return {
    id: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
    tenantId: ACTOR.userId,
    providerPageId: "page_runtime",
    name: "Runtime Page",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    webhookUrl: "https://example.com/webhook",
    pageAccessTokenEncrypted: "encrypted",
    webhookSigningSecretEncrypted: "encrypted",
    connectedAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-29T18:00:00.000Z"),
  }
}

function runtimeUser() {
  return {
    id: ACTOR.userId,
    email: "person@example.com",
    passwordHash: "hash",
    waitlisted: false,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  }
}

function runtimeDatabase(): RuntimeDatabase {
  return new RuntimeDatabase(runtimePage(), runtimeUser(), activeSubscription())
}

function activeSubscription(): SubscriptionRecord {
  return {
    tenantId: ACTOR.userId,
    stripeSubscriptionId: "sub_current",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    lastStripeEventAt: new Date("2026-07-01T00:00:00.000Z"),
  }
}

async function signedMetaCallback(providerMessageId: string) {
  const raw = JSON.stringify({
    entry: [
      {
        id: runtimePage().providerPageId,
        messaging: [
          {
            sender: { id: "psid_1" },
            timestamp: 1_785_348_000_000,
            message: {
              mid: providerMessageId,
              text: "Hello runtime",
            },
          },
        ],
      },
    ],
  })
  const signature = await hmacHex(String(env.META_APP_SECRET), raw)
  return workerExports.default.fetch("https://api.resender.dev/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${signature}` },
    body: raw,
  })
}

function queueSendResult(): QueueSendResponse {
  return {
    metadata: {
      metrics: {
        backlogCount: 0,
        backlogBytes: 0,
      },
    },
  }
}

function stripeSubscriptionEvent(input: {
  eventId: string
  subscriptionId: string
  status: string
  created: number
}): Record<string, unknown> {
  return {
    id: input.eventId,
    object: "event",
    created: input.created,
    data: {
      object: {
        id: input.subscriptionId,
        object: "subscription",
        customer: "cus_runtime",
        status: input.status,
        metadata: { tenantId: ACTOR.userId },
        cancel_at_period_end: false,
        items: {
          data: [
            {
              current_period_start: 1_785_283_200,
              current_period_end: 1_787_961_600,
              price: {
                id: "price_runtime",
                lookup_key: "starter_monthly",
              },
            },
          ],
        },
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type:
      input.status === "canceled"
        ? "customer.subscription.deleted"
        : "customer.subscription.created",
  }
}
