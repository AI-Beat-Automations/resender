import { describe, expect, it } from "vitest"

import { extractInboundEvents } from "./meta-webhook"

describe("Meta webhook extraction", () => {
  it("extracts text messages and ignores non-message events", () => {
    const [message] = extractInboundEvents({
      entry: [
        {
          id: "page_1",
          messaging: [
            {
              sender: { id: "psid_1" },
              timestamp: 1700000000000,
              message: { mid: "mid_1", text: " hola " },
            },
            { sender: { id: "psid_2" }, message: { mid: "mid_2" } },
          ],
        },
      ],
    })

    expect(message).toMatchObject({
      eventType: "message",
      metaPageId: "page_1",
      senderId: "psid_1",
      text: "hola",
      metaMessageId: "mid_1",
      postbackPayload: null,
    })
  })

  it("extracts postbacks as inbound events", () => {
    const [event] = extractInboundEvents({
      entry: [
        {
          id: "page_1",
          messaging: [
            {
              sender: { id: "psid_1" },
              timestamp: 1700000000000,
              postback: { title: "Start", payload: "GET_STARTED" },
            },
          ],
        },
      ],
    })

    expect(event).toMatchObject({
      eventType: "postback",
      metaPageId: "page_1",
      senderId: "psid_1",
      text: "GET_STARTED",
      postbackPayload: "GET_STARTED",
    })
    expect(event?.metaMessageId).toBe(
      "postback:page_1:psid_1:1700000000000:R0VUX1NUQVJURUQ"
    )
  })
})
