import { describe, expect, it } from "vitest"

import { buildInboundPushPayload } from "./external-push"

describe("inbound push payload", () => {
  it("includes tenant, page, conversation and message context", () => {
    const payload = buildInboundPushPayload({
      page: {
        id: "page-row",
        tenantId: "tenant-1",
        metaPageId: "meta-page",
        name: "Main Page",
        status: "active",
        webhookUrl: "https://example.com/hook",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        disconnectedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      conversation: {
        id: "conversation-1",
        tenantId: "tenant-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        contactName: null,
        lastMessageAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      message: {
        id: "message-1",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        direction: "inbound",
        status: "received",
        text: "hola",
        metaMessageId: "mid-1",
        error: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    })

    expect(payload).toEqual({
      tenant: { id: "tenant-1" },
      page: { id: "page-row", metaPageId: "meta-page", name: "Main Page" },
      conversation: { id: "conversation-1", contactId: "psid-1" },
      message: {
        id: "message-1",
        metaMessageId: "mid-1",
        direction: "inbound",
        status: "received",
        text: "hola",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    })
  })
})
