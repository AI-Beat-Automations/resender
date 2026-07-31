import { readFile } from "node:fs/promises"

import { beforeEach, describe, expect, it, vi } from "vitest"

const openNext = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
}))

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: openNext.getCloudflareContext,
}))

import {
  GET as getMetaWebhook,
  POST as postMetaWebhook,
} from "../../app/api/meta/webhook/route"
import { POST as postStripeWebhook } from "../../app/api/stripe/webhook/route"

describe("provider callback proxy", () => {
  beforeEach(() => {
    openNext.getCloudflareContext.mockReset()
    vi.restoreAllMocks()
  })

  it.each([
    {
      name: "Meta",
      invoke: postMetaWebhook,
      publicUrl:
        "https://resender.dev/api/meta/webhook?source=provider%2Bcallback",
      upstreamPath: "/webhooks/meta",
      signatureHeader: "x-hub-signature-256",
      signature: "sha256=byte-identical-signature",
    },
    {
      name: "Stripe",
      invoke: postStripeWebhook,
      publicUrl:
        "https://resender.dev/api/stripe/webhook?source=provider%2Bcallback",
      upstreamPath: "/webhooks/stripe",
      signatureHeader: "stripe-signature",
      signature: "t=1785360000,v1=byte-identical-signature",
    },
  ])(
    "forwards $name bytes, signature and essential headers unchanged",
    async ({ invoke, publicUrl, upstreamPath, signatureHeader, signature }) => {
      const bytes = new Uint8Array([
        0x7b, 0x22, 0x75, 0x74, 0x66, 0x38, 0x22, 0x3a, 0x22, 0xc3, 0xb1, 0x22,
        0x2c, 0x22, 0x6e, 0x75, 0x6c, 0x22, 0x3a, 0x00, 0x7d,
      ])
      const upstreamResponse = new Response(null, { status: 204 })
      let upstreamRequest: Request | undefined
      const fetch = vi.fn(async (request: Request) => {
        upstreamRequest = request
        return upstreamResponse
      })
      openNext.getCloudflareContext.mockResolvedValue({
        env: { BACKEND: { fetch } },
      })
      const request = new Request(publicUrl, {
        method: "POST",
        headers: {
          [signatureHeader]: signature,
          "content-type": "application/json; charset=utf-8",
          "content-length": String(bytes.byteLength),
          "x-provider-delivery": "delivery-42",
        },
        body: bytes,
      })
      const text = vi.spyOn(request, "text")
      const json = vi.spyOn(request, "json")
      const arrayBuffer = vi.spyOn(request, "arrayBuffer")

      const response = await invoke(request)

      expect(response).toBe(upstreamResponse)
      expect(fetch).toHaveBeenCalledOnce()
      expect(openNext.getCloudflareContext).toHaveBeenCalledWith({
        async: true,
      })
      if (!upstreamRequest) throw new Error("Expected an upstream request")
      expect(new URL(upstreamRequest.url)).toMatchObject({
        origin: "https://backend.internal",
        pathname: upstreamPath,
        search: "?source=provider%2Bcallback",
      })
      expect(upstreamRequest.method).toBe("POST")
      expect(upstreamRequest.headers.get(signatureHeader)).toBe(signature)
      expect(upstreamRequest.headers.get("content-type")).toBe(
        "application/json; charset=utf-8"
      )
      expect(upstreamRequest.headers.get("content-length")).toBe(
        String(bytes.byteLength)
      )
      expect(upstreamRequest.headers.get("x-provider-delivery")).toBe(
        "delivery-42"
      )
      await expect(upstreamRequest.arrayBuffer()).resolves.toEqual(bytes.buffer)
      expect(text).not.toHaveBeenCalled()
      expect(json).not.toHaveBeenCalled()
      expect(arrayBuffer).not.toHaveBeenCalled()
    }
  )

  it("forwards the Meta challenge query through the GET handler", async () => {
    let upstreamRequest: Request | undefined
    const response = new Response("challenge-value", {
      status: 200,
      headers: { "x-api-handler": "meta-challenge" },
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: {
        BACKEND: {
          fetch: vi.fn(async (request: Request) => {
            upstreamRequest = request
            return response
          }),
        },
      },
    })
    const request = new Request(
      "https://resender.dev/api/meta/webhook?hub.mode=subscribe&hub.verify_token=opaque&hub.challenge=challenge-value"
    )

    await expect(getMetaWebhook(request)).resolves.toBe(response)

    if (!upstreamRequest) throw new Error("Expected an upstream request")
    expect(upstreamRequest.method).toBe("GET")
    expect(new URL(upstreamRequest.url)).toMatchObject({
      pathname: "/webhooks/meta",
      search:
        "?hub.mode=subscribe&hub.verify_token=opaque&hub.challenge=challenge-value",
    })
  })

  it("returns the API response object without buffering its stream", async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("streamed"))
        controller.close()
      },
    })
    const upstreamResponse = new Response(body, {
      status: 202,
      headers: {
        "content-type": "application/octet-stream",
        "retry-after": "7",
        "x-api-response": "preserved",
      },
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: {
        BACKEND: {
          fetch: vi.fn().mockResolvedValue(upstreamResponse),
        },
      },
    })

    const response = await postMetaWebhook(
      new Request("https://resender.dev/api/meta/webhook", {
        method: "POST",
        body: "{}",
      })
    )

    expect(response).toBe(upstreamResponse)
    expect(response.status).toBe(202)
    expect(response.headers.get("retry-after")).toBe("7")
    expect(response.headers.get("x-api-response")).toBe("preserved")
    expect(response.body).toBe(body)
    expect(response.bodyUsed).toBe(false)
  })

  it.each([
    {
      name: "context failure",
      arrange() {
        openNext.getCloudflareContext.mockRejectedValue(
          new Error("META_APP_SECRET=must-not-leak")
        )
      },
    },
    {
      name: "missing binding",
      arrange() {
        openNext.getCloudflareContext.mockResolvedValue({ env: {} })
      },
    },
    {
      name: "binding failure",
      arrange() {
        openNext.getCloudflareContext.mockResolvedValue({
          env: {
            BACKEND: {
              fetch: vi
                .fn()
                .mockRejectedValue(new Error("raw-body=must-not-leak")),
            },
          },
        })
      },
    },
  ])("fails closed with a fixed 503 on $name", async ({ arrange }) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    arrange()

    const response = await postStripeWebhook(
      new Request("https://resender.dev/api/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": "t=secret,v1=secret",
        },
        body: '{"token":"must-not-leak"}',
      })
    )

    expect(response.status).toBe(503)
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    )
    expect(await response.text()).toBe("service unavailable")
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it("keeps the bridge server-only, streaming and free of callback domain code", async () => {
    const [proxy, metaRoute, stripeRoute] = await Promise.all([
      readFile(
        new URL("./provider-callback-proxy.ts", import.meta.url),
        "utf8"
      ),
      readFile(
        new URL("../../app/api/meta/webhook/route.ts", import.meta.url),
        "utf8"
      ),
      readFile(
        new URL("../../app/api/stripe/webhook/route.ts", import.meta.url),
        "utf8"
      ),
    ])

    expect(proxy.startsWith('import "server-only"')).toBe(true)
    expect(proxy).not.toMatch(/\.(?:text|json|arrayBuffer)\s*\(/u)
    expect(`${metaRoute}\n${stripeRoute}`).not.toMatch(
      /(?:from\s+["'](?:node:)?crypto["']|from\s+["']stripe["']|posthog|process\.env|@\/lib\/(?:db|inbound|billing)|META_APP_SECRET|STRIPE_WEBHOOK_SECRET)/u
    )
    expect(metaRoute).toContain('"/webhooks/meta"')
    expect(stripeRoute).toContain('"/webhooks/stripe"')
  })
})
