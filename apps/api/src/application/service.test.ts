import { describe, expect, it, vi } from "vitest"
import type Stripe from "stripe"

import type {
  PageRecord,
  SqlRepository,
  SubscriptionRecord,
  UserRecord,
} from "../infrastructure/db/repository"
import type { MetaClient } from "../infrastructure/meta/client"
import { createApp } from "../http/app"
import {
  decryptSecret,
  hashApiKey,
  hmacHex,
} from "../infrastructure/crypto/secrets"
import { ApiService } from "./service"

const PEPPER = "test-pepper"
const API_KEY = "pk_live_test-secret"

describe("API key authentication", () => {
  it("distinguishes a missing key from an invalid key", async () => {
    const service = serviceWithRepository({})
    await expect(service.authenticateApiKey(null)).rejects.toMatchObject({
      code: "missing_api_key",
      status: 401,
    })
    await expect(
      service.authenticateApiKey("Bearer wrong")
    ).rejects.toMatchObject({
      code: "invalid_api_key",
      status: 401,
    })
  })

  it("rejects revoked keys without updating last-used time", async () => {
    const touchApiKey = vi.fn(async () => true)
    const service = serviceWithRepository({
      getApiKeyByHash: async () => ({
        id: "key_1",
        tenantId: "tenant_1",
        secretHash: await hashApiKey(PEPPER, API_KEY),
        status: "revoked",
        waitlisted: false,
      }),
      touchApiKey,
    })
    await expect(
      service.authenticateApiKey(`Bearer ${API_KEY}`)
    ).rejects.toMatchObject({ code: "invalid_api_key", status: 401 })
    expect(touchApiKey).not.toHaveBeenCalled()
  })

  it("authenticates active keys and awaits the last-used update", async () => {
    const touchApiKey = vi.fn(async () => true)
    const service = serviceWithRepository({
      getApiKeyByHash: async (hash: string) => ({
        id: "key_1",
        tenantId: "tenant_1",
        secretHash: hash,
        status: "active",
        waitlisted: false,
      }),
      touchApiKey,
    })
    await expect(
      service.authenticateApiKey(`Bearer ${API_KEY}`)
    ).resolves.toEqual({ tenantId: "tenant_1", apiKeyId: "key_1" })
    expect(touchApiKey).toHaveBeenCalledWith("key_1")
  })

  it("fails closed when the last-used update cannot confirm the key is active", async () => {
    const service = serviceWithRepository({
      getApiKeyByHash: async () => ({
        id: "key_1",
        tenantId: "tenant_1",
        secretHash: "hash",
        status: "active",
        waitlisted: false,
      }),
      touchApiKey: async () => false,
    })
    await expect(
      service.authenticateApiKey(`Bearer ${API_KEY}`)
    ).rejects.toMatchObject({ code: "invalid_api_key", status: 401 })
  })
})

describe("product access gates", () => {
  it.each([
    {
      name: "waitlisted account",
      user: user({ waitlisted: true }),
      subscription: subscription(),
      code: "account_waitlisted",
    },
    {
      name: "inactive subscription",
      user: user(),
      subscription: subscription({ status: "past_due" }),
      code: "subscription_required",
    },
    {
      name: "missing subscription",
      user: user(),
      subscription: null,
      code: "subscription_required",
    },
  ])("preserves the canonical code for a $name", async (testCase) => {
    const service = serviceWithRepository({
      getUserById: async () => testCase.user,
      getSubscription: async () => testCase.subscription,
    })
    await expect(
      service.requireProductAccess("tenant_1")
    ).rejects.toMatchObject({ code: testCase.code, status: 403 })
  })

  it.each([
    ["product shell", (service: ApiService) => service.getProductShell(actor)],
    [
      "Meta page selection",
      (service: ApiService) => service.listAuthorizedMetaPages(actor),
    ],
    [
      "Meta authorization exchange",
      (service: ApiService) =>
        service.exchangeMetaAuthorizationCode(actor, {
          code: "code",
          redirectUri: "https://resender.dev/connections",
        }),
    ],
    [
      "Meta connect",
      (service: ApiService) =>
        service.connectMetaPages(actor, { providerPageIds: ["page_1"] }),
    ],
    [
      "Meta disconnect",
      (service: ApiService) => service.disconnectPage(actor, PAGE_ID),
    ],
    ["API key list", (service: ApiService) => service.listApiKeys(actor)],
  ])("applies the waitlist gate to RPC %s", async (_name, invoke) => {
    const metaCall = vi.fn()
    const service = serviceWithRepository(
      {
        getUserById: async () => user({ waitlisted: true }),
      },
      { listPages: metaCall }
    )
    await expect(invoke(service)).rejects.toMatchObject({
      code: "account_waitlisted",
    })
    expect(metaCall).not.toHaveBeenCalled()
  })
})

describe("inbound Meta ingestion", () => {
  it.each([
    ["waitlisted", user({ waitlisted: true }), subscription()],
    ["inactive", user(), subscription({ status: "past_due" })],
  ])("discards an event for a %s tenant", async (_name, tenant, plan) => {
    const ingestInbound = vi.fn()
    const queueSend = vi.fn()
    const service = inboundService(
      {
        getUserById: async () => tenant,
        getSubscription: async () => plan,
        ingestInbound,
      },
      queueSend
    )
    await expect(invokeInbound(service)).resolves.toEqual({ accepted: 0 })
    expect(ingestInbound).not.toHaveBeenCalled()
    expect(queueSend).not.toHaveBeenCalled()
  })

  it.each([
    ["quota_exceeded", 50_000, 1],
    ["page_limit_exceeded", 0, 3],
  ])(
    "persists and counts an inbound blocked by %s without enqueueing delivery",
    async (blockCode, usage, activePageCount) => {
      const ingestInbound = vi.fn(async () => ({
        inserted: true,
        messageId: MESSAGE_ID,
        jobId: JOB_ID,
        jobStatus: "failed_permanent" as const,
        jobAttemptCount: 0,
        jobRecoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      }))
      const queueSend = vi.fn()
      const service = inboundService(
        {
          getUsage: async () => usage,
          countActivePages: async () => activePageCount,
          ingestInbound,
        },
        queueSend
      )
      await expect(invokeInbound(service)).resolves.toEqual({ accepted: 1 })
      expect(ingestInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          periodStart: expect.any(Date),
          deliveryEnabled: false,
          deliveryBlockedReason: `account is restricted: ${blockCode}`,
          recoverAfter: expect.any(Date),
        })
      )
      expect(queueSend).not.toHaveBeenCalled()
    }
  )

  it("persists plan-unavailable inbound events instead of treating every entitlement block as a discard", async () => {
    const ingestInbound = vi.fn(async () => ({
      inserted: true,
      messageId: MESSAGE_ID,
      jobId: JOB_ID,
      jobStatus: "failed_permanent" as const,
      jobAttemptCount: 0,
      jobRecoverAfter: new Date("2026-07-29T18:02:00.000Z"),
    }))
    const queueSend = vi.fn()
    const service = inboundService(
      {
        getSubscription: async () =>
          subscription({ priceLookupKey: "unknown_plan" }),
        ingestInbound,
      },
      queueSend
    )
    await expect(invokeInbound(service)).resolves.toEqual({ accepted: 1 })
    expect(ingestInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryEnabled: false,
        deliveryBlockedReason: "account is restricted: plan_unavailable",
      })
    )
    expect(queueSend).not.toHaveBeenCalled()
  })

  it("returns an error on Queue send failure and re-enqueues the deduplicated pending job on retry", async () => {
    const ingestInbound = vi
      .fn()
      .mockResolvedValueOnce({
        inserted: true,
        messageId: MESSAGE_ID,
        jobId: JOB_ID,
        jobStatus: "pending",
        jobAttemptCount: 0,
        jobRecoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      })
      .mockResolvedValueOnce({
        inserted: false,
        messageId: MESSAGE_ID,
        jobId: JOB_ID,
        jobStatus: "pending",
        jobAttemptCount: 0,
        jobRecoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      })
    const queueSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("Queue unavailable"))
      .mockResolvedValueOnce(undefined)
    const service = inboundService({ ingestInbound }, queueSend)

    await expect(invokeInbound(service)).rejects.toThrow("Queue unavailable")
    await expect(invokeInbound(service)).resolves.toEqual({ accepted: 0 })
    expect(ingestInbound).toHaveBeenCalledTimes(2)
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(queueSend).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      messageId: MESSAGE_ID,
    })
  })

  it("does not let a Meta duplicate bypass a pending job's durable retry backoff", async () => {
    const ingestInbound = vi.fn(async () => ({
      inserted: false,
      messageId: MESSAGE_ID,
      jobId: JOB_ID,
      jobStatus: "pending" as const,
      jobAttemptCount: 4,
      jobRecoverAfter: new Date("2026-07-29T18:07:00.000Z"),
    }))
    const queueSend = vi.fn()
    const service = inboundService({ ingestInbound }, queueSend)

    await expect(invokeInbound(service)).resolves.toEqual({ accepted: 0 })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it("returns HTTP 500 on Queue handoff failure and succeeds when Meta retries the deduplicated event", async () => {
    const ingestInbound = vi
      .fn()
      .mockResolvedValueOnce({
        inserted: true,
        messageId: MESSAGE_ID,
        jobId: JOB_ID,
        jobStatus: "pending",
        jobAttemptCount: 0,
        jobRecoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      })
      .mockResolvedValueOnce({
        inserted: false,
        messageId: MESSAGE_ID,
        jobId: JOB_ID,
        jobStatus: "pending",
        jobAttemptCount: 0,
        jobRecoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      })
    const queueSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("Queue unavailable"))
      .mockResolvedValueOnce(undefined)
    const service = inboundService({ ingestInbound }, queueSend)
    const app = createApp({ serviceFactory: () => service })
    const { raw, signature } = await signedInboundRequest()

    const first = await app.request(
      "https://api.resender.dev/webhooks/meta",
      {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body: raw,
      },
      service.env
    )
    expect(first.status).toBe(500)

    const retry = await app.request(
      "https://api.resender.dev/webhooks/meta",
      {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body: raw,
      },
      service.env
    )
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ ok: true, accepted: 0 })
    expect(queueSend).toHaveBeenCalledTimes(2)
  })
})

describe("tenant-owned resources", () => {
  it("returns 404 instead of an empty delivery list for a foreign message", async () => {
    const listDeliveries = vi.fn()
    const service = serviceWithRepository({
      getMessage: async () => null,
      listDeliveries,
    })
    await expect(
      service.listDeliveries("tenant_1", MESSAGE_ID, { limit: 25 })
    ).rejects.toMatchObject({ code: "not_found", status: 404 })
    expect(listDeliveries).not.toHaveBeenCalled()
  })

  it("requires a signing secret before enabling a Page webhook", async () => {
    const updatePageWebhook = vi.fn()
    const service = serviceWithRepository({
      getPage: async () => page({ webhookSigningSecretEncrypted: null }),
      updatePageWebhook,
    })
    await expect(
      service.updatePageWebhook(
        "tenant_1",
        PAGE_ID,
        "https://93.184.216.34/webhook"
      )
    ).rejects.toMatchObject({
      code: "validation_error",
      status: 400,
      details: [
        {
          path: "webhookUrl",
          message: "Rotate the webhook signing secret first.",
        },
      ],
    })
    expect(updatePageWebhook).not.toHaveBeenCalled()
  })

  it("returns 404 and does not rotate a secret for a foreign Page", async () => {
    const rotateWebhookSecret = vi.fn()
    const service = serviceWithRepository({
      getPage: async () => null,
      rotateWebhookSecret,
    })

    await expect(
      service.rotateWebhookSecret("tenant_1", PAGE_ID)
    ).rejects.toMatchObject({ code: "not_found", status: 404 })
    expect(rotateWebhookSecret).not.toHaveBeenCalled()
  })

  it("reveals a rotated signing secret once and persists only ciphertext", async () => {
    const rotatedAt = new Date("2026-07-29T18:03:00.000Z")
    const persistedInputs: Array<{
      tenantId: string
      pageId: string
      encryptedSecret: string
    }> = []
    const rotateWebhookSecret = vi.fn(
      async (input: {
        tenantId: string
        pageId: string
        encryptedSecret: string
      }) => {
        persistedInputs.push(input)
        return rotatedAt
      }
    )
    const service = serviceWithRepository({
      getPage: async () => page(),
      rotateWebhookSecret,
    })

    const result = await service.rotateWebhookSecret("tenant_1", PAGE_ID)
    const persisted = persistedInputs[0]
    if (!persisted) throw new Error("expected persisted secret")

    expect(result).toMatchObject({
      secret: expect.stringMatching(/^whsec_/u),
      createdAt: rotatedAt.toISOString(),
    })
    expect(persisted.encryptedSecret).not.toContain(result.secret)
    expect(
      decryptSecret(service.env.TOKEN_ENCRYPTION_KEY, persisted.encryptedSecret)
    ).toBe(result.secret)
  })

  it("keeps public and RPC Page mappings separate", async () => {
    const updated = page({
      tokenError: "expired",
      tokenErrorAt: new Date("2026-07-29T18:01:00.000Z"),
      disconnectedAt: new Date("2026-07-29T18:02:00.000Z"),
    })
    const service = serviceWithRepository({
      getPage: async () => page(),
      updatePageWebhook: async () => updated,
    })

    const publicPage = await service.updatePageWebhook(
      "tenant_1",
      PAGE_ID,
      null
    )
    const rpcPage = await service.updatePageWebhookForRpc(
      "tenant_1",
      PAGE_ID,
      null
    )

    expect(publicPage).not.toHaveProperty("tokenError")
    expect(rpcPage).toMatchObject({
      tokenError: "expired",
      tokenErrorAt: "2026-07-29T18:01:00.000Z",
      disconnectedAt: "2026-07-29T18:02:00.000Z",
    })
    expect(rpcPage).not.toHaveProperty("pageAccessTokenEncrypted")
  })
})

describe("web application URL allowlists", () => {
  it("fails closed when the environment allowlist is absent", async () => {
    const service = serviceWithRepository({
      getUserById: async () => user(),
    })
    Reflect.deleteProperty(service.env, "WEB_APP_ORIGINS")

    await expect(
      service.createCheckoutSession(actor, {
        priceLookupKey: "starter_monthly",
        returnUrl: "https://resender.dev",
      })
    ).rejects.toMatchObject({ code: "internal_error", status: 500 })
  })

  it("rejects unlisted Stripe origins and paths before provider access", async () => {
    const getSubscription = vi.fn()
    const service = serviceWithRepository({
      getUserById: async () => user(),
      getSubscription,
    })

    await expect(
      service.createCheckoutSession(actor, {
        priceLookupKey: "starter_monthly",
        returnUrl: "https://attacker.example",
      })
    ).rejects.toMatchObject({
      code: "validation_error",
      status: 400,
      details: [{ path: "returnUrl" }],
    })
    await expect(
      service.createCheckoutSession(actor, {
        priceLookupKey: "starter_monthly",
        returnUrl: "https://resender.dev/redirect",
      })
    ).rejects.toMatchObject({ code: "validation_error", status: 400 })
    expect(getSubscription).not.toHaveBeenCalled()
  })

  it("constructs Checkout paths on the allowed origin", async () => {
    const createCheckout = vi.fn(async () => ({
      url: "https://checkout.stripe.test/session",
    }))
    const service = serviceWithRepository(
      {
        getUserById: async () => user(),
        getSubscription: async () => null,
        getStripeCustomerId: async () => "cus_1",
      },
      {},
      {
        prices: { list: async () => ({ data: [{ id: "price_1" }] }) },
        checkout: { sessions: { create: createCheckout } },
      }
    )

    await service.createCheckoutSession(actor, {
      priceLookupKey: "starter_monthly",
      returnUrl: "https://resender.dev/",
    })

    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url:
          "https://resender.dev/billing/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://resender.dev/billing",
      })
    )
  })

  it("requires the exact configured Meta callback URL", async () => {
    const exchangeAuthorizationCode = vi.fn(async () => "meta-token")
    const saveMetaUserToken = vi.fn()
    const service = serviceWithRepository(
      {
        getUserById: async () => user(),
        getSubscription: async () => subscription(),
        saveMetaUserToken,
      },
      { exchangeAuthorizationCode }
    )

    await expect(
      service.exchangeMetaAuthorizationCode(actor, {
        code: "code",
        redirectUri: "https://resender.dev/connections",
      })
    ).rejects.toMatchObject({
      code: "validation_error",
      details: [{ path: "redirectUri" }],
    })
    await service.exchangeMetaAuthorizationCode(actor, {
      code: "code",
      redirectUri: "https://resender.dev/api/meta/callback",
    })

    expect(exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: "code",
      redirectUri: "https://resender.dev/api/meta/callback",
    })
    expect(saveMetaUserToken).toHaveBeenCalledOnce()
  })
})

describe("conversation thread pagination", () => {
  it("declares descending message order and preserves pagination", async () => {
    const service = serviceWithRepository({
      getConversation: async () => ({
        id: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
        page: {
          id: PAGE_ID,
          providerPageId: "provider_page_1",
          name: "Support",
        },
        contact: { id: "psid", name: null },
        latestMessage: null,
        lastMessageAt: "2026-07-29T18:00:00.000Z",
        createdAt: "2026-07-29T18:00:00.000Z",
        updatedAt: "2026-07-29T18:00:00.000Z",
      }),
      listConversationMessages: async () => ({
        data: [],
        pagination: { hasMore: true, nextCursor: "next" },
      }),
    })

    await expect(
      service.getConversationThread(
        "tenant_1",
        "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
        { limit: 100 }
      )
    ).resolves.toMatchObject({
      order: "newest_first",
      pagination: { hasMore: true, nextCursor: "next" },
    })
  })
})

describe("readiness", () => {
  it("blocks cutover while a configured webhook lacks a signing secret", async () => {
    const service = serviceWithRepository({
      ping: async () => true,
      countUnsignedWebhookPages: async () => 1,
    })
    await expect(service.ready()).resolves.toBe(false)
  })
})

describe("Stripe provider boundaries and duplicate cleanup", () => {
  it("normalizes Stripe network failures to the provider contract", async () => {
    const service = serviceWithRepository(
      {
        getUserById: async () => user(),
        getSubscription: async () => null,
        getStripeCustomerId: async () => "cus_1",
      },
      {},
      {
        prices: {
          list: async () => {
            throw new Error("network details")
          },
        },
      }
    )
    await expect(
      service.createCheckoutSession(actor, {
        priceLookupKey: "starter_monthly",
        returnUrl: "https://resender.dev",
      })
    ).rejects.toMatchObject({
      name: "ContractError",
      code: "provider_unavailable",
      status: 502,
      message: "Stripe is temporarily unavailable.",
    })
  })

  it("does not cancel or refund when the ordering decision has no superseded subscription", async () => {
    const cancel = vi.fn()
    const refund = vi.fn()
    const service = stripeWebhookService(
      { applied: false, supersededSubscriptionId: null },
      { cancel, refund }
    )
    await expect(
      service.handleStripeWebhook("{}", "signature")
    ).resolves.toEqual({ received: true })
    expect(cancel).not.toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
  })

  it("cancels and refunds only the live duplicate returned by persistence", async () => {
    const cancel = vi.fn(async () => undefined)
    const refund = vi.fn(async () => undefined)
    const service = stripeWebhookService(
      { applied: true, supersededSubscriptionId: "sub_superseded" },
      { cancel, refund }
    )
    await service.handleStripeWebhook("{}", "signature")
    expect(cancel).toHaveBeenCalledWith("sub_superseded")
    expect(refund).toHaveBeenCalledWith({ payment_intent: "pi_1" })
  })
})

describe("provider callback signatures", () => {
  it("verifies Meta over the exact raw body", async () => {
    const raw = '{"entry":[]}'
    const service = serviceWithRepository({})
    const signature = await hmacHex("secret", raw)
    await expect(
      service.verifyMetaSignature(raw, `sha256=${signature}`)
    ).resolves.toBeUndefined()
    await expect(
      service.verifyMetaSignature(`${raw} `, `sha256=${signature}`)
    ).rejects.toMatchObject({ code: "invalid_signature" })
  })

  it("accepts a valid Stripe signature and rejects an altered raw body", async () => {
    const raw = JSON.stringify({
      id: "evt_test",
      object: "event",
      created: 1_785_348_000,
      data: { object: {} },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "account.updated",
    })
    const service = serviceWithRepository({})
    const timestamp = Math.floor(Date.now() / 1000)
    const signature =
      await service.stripe.webhooks.generateTestHeaderStringAsync({
        payload: raw,
        secret: "whsec_test",
        timestamp,
      })
    await expect(service.handleStripeWebhook(raw, signature)).resolves.toEqual({
      received: true,
    })
    await expect(
      service.handleStripeWebhook(`${raw} `, signature)
    ).rejects.toMatchObject({ code: "invalid_signature" })
  })
})

function serviceWithRepository(
  methods: Partial<SqlRepository>,
  metaMethods: Partial<MetaClient> = {},
  stripeMethods?: object
): ApiService {
  return new ApiService(
    {
      API_KEY_PEPPER: PEPPER,
      AUTH_SECRET: "",
      META_APP_ID: "0",
      META_APP_SECRET: "secret",
      META_VERIFY_TOKEN: "verify",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      DATABASE_URL: "postgres://example",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      ENVIRONMENT: "staging",
      PUBLIC_BASE_URL: "https://api-staging.resender.dev",
      WEB_APP_ORIGINS: JSON.stringify(["https://resender.dev"]),
      API_RATE_LIMITER: { limit: async () => ({ success: true }) },
      WEBHOOK_DELIVERIES: {
        metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
        send: async () => ({
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        }),
        sendBatch: async () => ({
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        }),
      },
    } as Env,
    {
      repository: methods as SqlRepository,
      meta: metaMethods as MetaClient,
      ...(stripeMethods ? { stripe: stripeMethods as Stripe } : {}),
    }
  )
}

function stripeWebhookService(
  upsertResult: {
    applied: boolean
    supersededSubscriptionId: string | null
  },
  sideEffects: {
    cancel: ReturnType<typeof vi.fn>
    refund: ReturnType<typeof vi.fn>
  }
) {
  const stripeEvent = {
    type: "customer.subscription.deleted",
    created: 1_785_348_000,
    data: {
      object: {
        id: "sub_old",
        status: "canceled",
        customer: "cus_1",
        metadata: { tenantId: "tenant_1" },
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { lookup_key: "starter_monthly", id: "price_1" },
              current_period_start: 1_783_036_800,
              current_period_end: 1_785_715_200,
            },
          ],
        },
      },
    },
  } as unknown as Stripe.Event
  return serviceWithRepository(
    {
      upsertSubscription: async () => upsertResult,
    },
    {},
    {
      webhooks: {
        constructEventAsync: async () => stripeEvent,
      },
      subscriptions: {
        retrieve: async () => ({
          status: "active",
          latest_invoice: {
            payments: {
              data: [
                {
                  payment: { payment_intent: "pi_1" },
                },
              ],
            },
          },
        }),
        cancel: sideEffects.cancel,
      },
      refunds: { create: sideEffects.refund },
    }
  )
}

const actor = { userId: "tenant_1" }
const PAGE_ID = "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
const MESSAGE_ID = "ef55c94e-b861-4d19-9f9b-b5689028de80"
const JOB_ID = "d743db7b-d4b8-4911-bf01-c639816856fc"
const PERIOD_START = new Date("2026-07-01T00:00:00.000Z")
const PERIOD_END = new Date("2026-08-01T00:00:00.000Z")

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "tenant_1",
    email: "user@example.com",
    passwordHash: "hash",
    waitlisted: false,
    createdAt: PERIOD_START,
    ...overrides,
  }
}

function subscription(
  overrides: Partial<SubscriptionRecord> = {}
): SubscriptionRecord {
  return {
    tenantId: "tenant_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    lastStripeEventAt: PERIOD_START,
    ...overrides,
  }
}

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: PAGE_ID,
    tenantId: "tenant_1",
    providerPageId: "provider_page_1",
    name: "Support",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenErrorAt: null,
    webhookUrl: "https://93.184.216.34/webhook",
    pageAccessTokenEncrypted: "encrypted",
    webhookSigningSecretEncrypted: "encrypted-secret",
    connectedAt: PERIOD_START,
    disconnectedAt: null,
    updatedAt: PERIOD_START,
    ...overrides,
  }
}

function inboundService(
  overrides: Partial<SqlRepository>,
  queueSend: ReturnType<typeof vi.fn>
) {
  const service = serviceWithRepository({
    getActivePageByProviderId: async () => page(),
    getUserById: async () => user(),
    getSubscription: async () => subscription(),
    getUsage: async () => 0,
    countActivePages: async () => 1,
    ...overrides,
  })
  Object.defineProperty(service.env, "WEBHOOK_DELIVERIES", {
    value: { send: queueSend },
  })
  return service
}

async function invokeInbound(service: ApiService) {
  const { raw, signature } = await signedInboundRequest()
  return service.ingestMetaWebhook(raw, signature)
}

async function signedInboundRequest() {
  const raw = JSON.stringify({
    entry: [
      {
        id: "provider_page_1",
        messaging: [
          {
            sender: { id: "psid_1" },
            timestamp: PERIOD_START.getTime(),
            message: { mid: "mid.1", text: "hello" },
          },
        ],
      },
    ],
  })
  const signature = await hmacHex("secret", raw)
  return { raw, signature: `sha256=${signature}` }
}
