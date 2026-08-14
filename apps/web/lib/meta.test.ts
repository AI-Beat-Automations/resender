import { afterEach, describe, expect, it, vi } from "vitest"

import {
  META_WEBHOOK_SUBSCRIBED_FIELDS,
  subscribePagesToWebhook,
  unsubscribeFromWebhook,
  WebhookSubscriptionError,
} from "./meta"

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
      META_WEBHOOK_SUBSCRIBED_FIELDS
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

// `DELETE /{id}/subscribed_apps` es la misma llamada para una página de
// Facebook y para un WABA de WhatsApp: solo cambia el id. Por eso el canal es un
// parámetro, y por eso hay que fijarlo — con `"messenger"` fijo, el fallo al
// desuscribir un WABA aparecía en los logs como un fallo de Messenger con un id
// de WhatsApp, y el filtro por canal con el que se investiga un número que sigue
// recibiendo mensajes no lo encontraba nunca.
describe("Meta webhook unsubscribe", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("registra el fallo con el canal real y con el id que se pidió dar de baja", async () => {
    const lines: unknown[][] = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args)
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "Unsupported delete request" } })
    )

    await expect(
      unsubscribeFromWebhook("102030405060708", "wa-token", "whatsapp")
    ).resolves.toBe(false)

    expect(lines).toHaveLength(1)
    expect(lines[0]?.[0]).toMatchObject({
      action: "webhook_unsubscribe",
      outcome: "failed",
      reason: "unsubscribe_failed",
      channel: "whatsapp",
      accountId: "102030405060708",
    })
  })

  it("sigue registrando Messenger como Messenger", async () => {
    const lines: unknown[][] = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args)
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ success: false })
    )

    await expect(
      unsubscribeFromWebhook("meta-page-1", "page-token", "messenger")
    ).resolves.toBe(false)

    expect(lines[0]?.[0]).toMatchObject({
      channel: "messenger",
      accountId: "meta-page-1",
    })
  })
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })
}
