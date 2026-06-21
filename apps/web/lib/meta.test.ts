import { afterEach, describe, expect, it, vi } from "vitest"

import { subscribePagesToWebhook, WebhookSubscriptionError } from "./meta"

const page = (pageId: string) => ({
  pageId,
  name: `Page ${pageId}`,
  pageAccessToken: `token-${pageId}`,
})

describe("Meta webhook subscription", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("subscribes every authorized page to the webhook", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ success: true }))

    await expect(
      subscribePagesToWebhook([page("page_1"), page("page_2")])
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const body = fetchMock.mock.calls[0]?.[1]?.body
    expect(body).toBeInstanceOf(URLSearchParams)
    expect((body as URLSearchParams).get("subscribed_fields")).toBe(
      "messages,messaging_postbacks"
    )
  })

  it("fails all-or-nothing when Meta rejects one page subscription", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = url.toString()
      if (href.includes("page_2")) {
        return jsonResponse({ success: false })
      }
      return jsonResponse({ success: true })
    })

    let thrown: unknown
    try {
      await subscribePagesToWebhook([page("page_1"), page("page_2")])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(WebhookSubscriptionError)
    expect((thrown as WebhookSubscriptionError).failedPageIds).toEqual([
      "page_2",
    ])
  })

  it("fails all-or-nothing when a network error prevents subscription", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))

    let thrown: unknown
    try {
      await subscribePagesToWebhook([page("page_1")])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(WebhookSubscriptionError)
    expect((thrown as WebhookSubscriptionError).failedPageIds).toEqual([
      "page_1",
    ])
  })
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })
}
