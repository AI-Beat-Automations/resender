import { describe, expect, it } from "vitest"

import {
  ErrorEnvelopeSchema,
  PageSchema,
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
})
