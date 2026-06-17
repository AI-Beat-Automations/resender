import { describe, expect, it } from "vitest"

import { extractInboundTextMessages } from "./meta-webhook"

describe("Meta webhook extraction", () => {
  it("extracts text messages and ignores non-message events", () => {
    const [message] = extractInboundTextMessages({
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
      metaPageId: "page_1",
      senderId: "psid_1",
      text: "hola",
      metaMessageId: "mid_1",
    })
  })
})
