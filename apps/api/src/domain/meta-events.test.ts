import { describe, expect, it } from "vitest"

import { extractInboundMetaEvents } from "./meta-events"

describe("extractInboundMetaEvents", () => {
  it("extracts text and postback events and ignores unsupported entries", async () => {
    const events = await extractInboundMetaEvents({
      entry: [
        {
          id: "page_1",
          messaging: [
            {
              sender: { id: "psid_1" },
              timestamp: 1_785_348_000_000,
              message: { mid: "mid.1", text: " Hola " },
            },
            {
              sender: { id: "psid_1" },
              timestamp: 1_785_348_000_001,
              postback: { payload: "GET_STARTED" },
            },
            { sender: {}, message: { mid: "ignored", text: "ignored" } },
          ],
        },
      ],
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      providerPageId: "page_1",
      senderId: "psid_1",
      text: "Hola",
      providerMessageId: "mid.1",
    })
    expect(events[1]?.text).toBe("GET_STARTED")
    expect(events[1]?.providerMessageId).toMatch(/^postback:/u)
  })

  it("creates a stable synthetic postback id for Meta retries", async () => {
    const body = {
      entry: [
        {
          id: "page_1",
          messaging: [
            {
              sender: { id: "psid_1" },
              timestamp: 123,
              postback: { payload: "ACTION" },
            },
          ],
        },
      ],
    }
    const first = await extractInboundMetaEvents(body)
    const second = await extractInboundMetaEvents(body)
    expect(first[0]?.providerMessageId).toBe(second[0]?.providerMessageId)
  })
})
