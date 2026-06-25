import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getSql: () => sqlMock,
}))

import { buildInboundPushPayload, pushInboundMessage } from "./external-push"

const payload = {
  tenant: { id: "tenant-1" },
  page: { id: "page-row", metaPageId: "meta-page", name: "Main Page" },
  conversation: { id: "conversation-1", contactId: "psid-1" },
  message: {
    id: "message-1",
    metaMessageId: "mid-1",
    eventType: "message" as const,
    postbackPayload: null,
    direction: "inbound" as const,
    status: "received" as const,
    text: "hola",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
}

describe("inbound push payload", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
    vi.unstubAllGlobals()
  })

  it("includes tenant, page, conversation and message context", () => {
    const result = buildInboundPushPayload({
      page: {
        id: "page-row",
        tenantId: "tenant-1",
        metaPageId: "meta-page",
        name: "Main Page",
        status: "active",
        tokenStatus: "valid",
        tokenError: null,
        tokenErrorAt: null,
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
        providerResponse: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      eventType: "message",
      postbackPayload: null,
    })

    expect(result).toEqual(payload)
  })

  it("records a failed delivery without fetching unsafe webhook URLs", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await pushInboundMessage({
      messageId: "message-1",
      webhookUrl: "http://example.com/hook",
      payload,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(sqlMock.mock.calls[0]?.slice(1)).toEqual([
      "message-1",
      "http://example.com/hook",
      "failed",
      null,
      "The URL must use HTTPS. HTTP is only allowed for localhost in development.",
    ])
  })
})
