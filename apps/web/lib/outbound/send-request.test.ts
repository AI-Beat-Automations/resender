import { describe, expect, it } from "vitest"

import { getBearerToken, parseOutboundSendInput } from "./send-request"

describe("outbound send request", () => {
  it("extracts bearer tokens", () => {
    expect(getBearerToken("Bearer pk_live_abc")).toBe("pk_live_abc")
    expect(getBearerToken("bearer   pk_live_abc")).toBe("pk_live_abc")
    expect(getBearerToken("Basic abc")).toBeNull()
    expect(getBearerToken("Bearer pk_live_abc extra")).toBeNull()
    expect(getBearerToken(null)).toBeNull()
  })

  it("validates and trims the send payload", () => {
    expect(
      parseOutboundSendInput({
        pageId: " page ",
        recipientId: " psid ",
        reply: " hola ",
        conversationId: " conversation ",
      })
    ).toEqual({
      ok: true,
      value: {
        pageId: "page",
        recipientId: "psid",
        reply: "hola",
        conversationId: "conversation",
      },
    })
    expect(parseOutboundSendInput({ pageId: "page" }).ok).toBe(false)
  })
})
