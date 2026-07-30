import { describe, expect, it } from "vitest"

import {
  ApiKeySchema,
  ApiKeyCreateRpcInputSchema,
  AuthenticatedUserSchema,
  BillingStateSchema,
  CheckoutSessionRpcInputSchema,
  ConnectMetaPagesRpcInputSchema,
  ConversationThreadRpcInputSchema,
  CreatedApiKeySchema,
  ErrorEnvelopeSchema,
  MetaPageSelectionSchema,
  MetaAuthorizationRpcInputSchema,
  PageSchema,
  RpcPageSchema,
  SendMessageSchema,
  WebhookSecretSchema,
} from "./index"

describe("public contracts", () => {
  it("keeps the v1 page id distinct from the provider id", () => {
    const result = PageSchema.safeParse({
      id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
      provider: "meta",
      providerPageId: "10987654321",
      name: "Acme",
      status: "active",
      tokenStatus: "valid",
      webhook: { url: null, signingEnabled: false },
      connectedAt: "2026-07-29T18:00:00.000Z",
      updatedAt: "2026-07-29T18:00:00.000Z",
    })

    expect(result.success).toBe(true)
  })

  it("adds operational Page state only to the RPC contract", () => {
    const input = {
      id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
      provider: "meta",
      providerPageId: "10987654321",
      name: "Acme",
      status: "disconnected",
      tokenStatus: "invalid",
      tokenError: "Meta rejected the token",
      tokenErrorAt: "2026-07-29T18:01:00.000Z",
      disconnectedAt: "2026-07-29T18:02:00.000Z",
      webhook: { url: null, signingEnabled: true },
      connectedAt: "2026-07-29T18:00:00.000Z",
      updatedAt: "2026-07-29T18:02:00.000Z",
      pageAccessToken: "must-not-cross-the-boundary",
      webhookSigningSecret: "must-not-cross-the-boundary",
    }
    const rpcResult = RpcPageSchema.parse(input)

    expect(rpcResult).toMatchObject({
      tokenError: "Meta rejected the token",
      tokenErrorAt: "2026-07-29T18:01:00.000Z",
      disconnectedAt: "2026-07-29T18:02:00.000Z",
    })
    expect(rpcResult).not.toHaveProperty("pageAccessToken")
    expect(rpcResult).not.toHaveProperty("webhookSigningSecret")
    expect(PageSchema.parse(input)).not.toHaveProperty("tokenError")
  })

  it("keeps thread pagination optional for existing RPC callers", () => {
    const conversationId = "9e2327a8-0c42-493e-bd6c-c08ed81010f0"
    expect(ConversationThreadRpcInputSchema.parse({ conversationId })).toEqual({
      conversationId,
    })
    expect(
      ConversationThreadRpcInputSchema.safeParse({
        conversationId,
        limit: 101,
      }).success
    ).toBe(false)
  })

  it("requires the approved text message shape", () => {
    expect(
      SendMessageSchema.safeParse({
        pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
        recipientId: "psid",
        type: "text",
        text: "Hello",
      }).success
    ).toBe(true)
    expect(
      SendMessageSchema.safeParse({
        pageId: "10987654321",
        recipientId: "psid",
        type: "image",
      }).success
    ).toBe(false)
  })

  it("never accepts an unprefixed signing secret", () => {
    expect(
      WebhookSecretSchema.safeParse({
        secret: "not-a-webhook-secret",
        createdAt: "2026-07-29T18:00:00.000Z",
      }).success
    ).toBe(false)
  })

  it("restricts error envelopes to the canonical error-code enum", () => {
    const envelope = {
      error: {
        code: "account_waitlisted",
        message: "Restricted",
        requestId: "request_1",
      },
    }
    expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true)
    expect(
      ErrorEnvelopeSchema.safeParse({
        ...envelope,
        error: { ...envelope.error, code: "invented_error" },
      }).success
    ).toBe(false)
  })

  it("strips backend-only credentials and identifiers from RPC DTOs", () => {
    const apiKey = {
      id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
      label: "Production",
      visiblePrefix: "pk_live_abcd1234",
      status: "active",
      createdAt: "2026-07-29T18:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
      secretHash: "must-not-cross",
      pepper: "must-not-cross",
    }
    const listed = ApiKeySchema.parse(apiKey)
    const created = CreatedApiKeySchema.parse({
      apiKey: "pk_live_one-time-secret",
      record: apiKey,
      secretHash: "must-not-cross",
    })
    const user = AuthenticatedUserSchema.parse({
      id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
      email: "person@example.com",
      waitlisted: false,
      createdAt: "2026-07-29T18:00:00.000Z",
      passwordHash: "must-not-cross",
      metaUserAccessToken: "must-not-cross",
    })
    const billing = BillingStateSchema.parse({
      subscription: null,
      entitlement: {
        priceLookupKey: null,
        usage: 0,
        messageLimit: null,
        activePageCount: 0,
        pageLimit: null,
        blockCode: "plan_unavailable",
      },
      stripeCustomerId: "cus_must_not_cross",
      stripeSecretKey: "rk_must_not_cross",
    })
    const meta = MetaPageSelectionSchema.parse({
      pages: [
        {
          providerPageId: "page_1",
          name: "Page",
          state: "selectable",
          accessToken: "must-not-cross",
        },
      ],
      maxPages: 2,
      activePageCount: 0,
      remainingSlots: 2,
      userAccessToken: "must-not-cross",
    })

    expect(created).toEqual({
      apiKey: "pk_live_one-time-secret",
      record: listed,
    })
    expect(listed).not.toHaveProperty("secretHash")
    expect(listed).not.toHaveProperty("pepper")
    expect(user).not.toHaveProperty("passwordHash")
    expect(user).not.toHaveProperty("metaUserAccessToken")
    expect(billing).not.toHaveProperty("stripeCustomerId")
    expect(billing).not.toHaveProperty("stripeSecretKey")
    expect(meta).not.toHaveProperty("userAccessToken")
    expect(meta.pages[0]).not.toHaveProperty("accessToken")
  })

  it("bounds and normalizes sensitive RPC inputs", () => {
    expect(ApiKeyCreateRpcInputSchema.parse({ label: " Production " })).toEqual(
      { label: "Production" }
    )
    expect(
      CheckoutSessionRpcInputSchema.safeParse({
        priceLookupKey: "",
        returnUrl: "javascript:alert(1)",
      }).success
    ).toBe(false)
    expect(
      MetaAuthorizationRpcInputSchema.safeParse({
        code: "",
        redirectUri: "not-a-url",
      }).success
    ).toBe(false)
    expect(
      ConnectMetaPagesRpcInputSchema.safeParse({
        providerPageIds: [],
      }).success
    ).toBe(false)
    expect(
      ConnectMetaPagesRpcInputSchema.safeParse({
        providerPageIds: ["page_1", "page_1"],
      }).success
    ).toBe(false)
    expect(
      ConnectMetaPagesRpcInputSchema.safeParse({
        providerPageIds: Array.from(
          { length: 101 },
          (_, index) => `page_${index}`
        ),
      }).success
    ).toBe(false)
  })
})
