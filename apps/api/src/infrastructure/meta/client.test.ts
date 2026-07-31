import { describe, expect, it, vi } from "vitest"

import { MetaClient } from "./client"

describe("Meta client security and compatibility", () => {
  it("puts unsubscribe credentials in the DELETE query string", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          headers: { "content-type": "application/json" },
        })
    )
    const client = new MetaClient("app", "secret", fetcher)
    await client.unsubscribePage("page_1", "page-token")

    const [input, init] = fetcher.mock.calls[0] ?? []
    expect(String(input)).toContain("access_token=page-token")
    expect(init?.method).toBe("DELETE")
    expect(init?.body).toBeUndefined()
  })

  it("preserves every approved Meta webhook field", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          headers: { "content-type": "application/json" },
        })
    )
    const client = new MetaClient("app", "secret", fetcher)
    await client.subscribePage("page_1", "page-token")

    const parameters = new URLSearchParams(
      String(fetcher.mock.calls[0]?.[1]?.body)
    )
    expect(parameters.get("subscribed_fields")).toBe(
      "messages,messaging_postbacks,messaging_policy_enforcement"
    )
  })

  it("does not follow a provider-controlled pagination URL off Graph", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [],
            paging: {
              next: "https://attacker.example/steal?access_token=token",
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
    const client = new MetaClient("app", "secret", fetcher)

    await expect(client.listPages("user-token")).rejects.toMatchObject({
      code: "provider_unavailable",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("normalizes network failures to a serializable provider contract error", async () => {
    const client = new MetaClient(
      "app",
      "secret",
      vi.fn(async () => {
        throw new Error("socket details that must not cross RPC")
      })
    )
    await expect(client.listPages("user-token")).rejects.toMatchObject({
      name: "ContractError",
      code: "provider_unavailable",
      status: 502,
      message: "Meta is temporarily unavailable.",
    })
  })

  it("normalizes a Graph 429 response to the approved unavailable contract", async () => {
    const client = new MetaClient(
      "app",
      "secret",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
            status: 429,
          })
      )
    )

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        redirectUri: "https://app.resender.dev/callback",
      })
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      status: 502,
      message: "Meta is temporarily unavailable.",
    })
  })

  it("normalizes a Graph 5xx response to the approved unavailable contract", async () => {
    const client = new MetaClient(
      "app",
      "secret",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "Provider outage" } }),
            { status: 503 }
          )
      )
    )

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        redirectUri: "https://app.resender.dev/callback",
      })
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      status: 502,
      message: "Meta is temporarily unavailable.",
    })
  })

  it("never exposes a network error URL or access token from sendText", async () => {
    const client = new MetaClient(
      "app",
      "secret",
      vi.fn(async () => {
        throw new Error(
          "https://graph.facebook.com/me/messages?access_token=SECRET"
        )
      })
    )

    const result = await client.sendText({
      pageAccessToken: "page-token",
      recipientId: "psid",
      text: "sensitive body",
    })

    expect(result).toMatchObject({
      ok: false,
      kind: "unavailable",
      message: "Meta is temporarily unavailable.",
    })
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|access_token|graph\\.facebook|sensitive body/u
    )
  })

  it("never exposes a network error URL or access token from legacy send", async () => {
    const client = new MetaClient(
      "app",
      "secret",
      vi.fn(async () => {
        throw new Error(
          "https://graph.facebook.com/v23.0/page/messages?access_token=SECRET"
        )
      })
    )

    const result = await client.sendLegacyText({
      pageId: "page",
      pageAccessToken: "SECRET",
      recipientId: "psid",
      text: "sensitive body",
    })

    expect(result).toEqual({
      ok: false,
      status: 502,
      data: null,
      error: "Meta request failed",
      reason:
        "Could not reach Meta's Send API (network error or timeout). Retry shortly.",
    })
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|access_token|graph\\.facebook|sensitive body/u
    )
  })

  it("preserves the legacy null body and HTTP fallback for non-JSON Meta errors", async () => {
    const client = new MetaClient(
      "app",
      "secret",
      vi.fn(async () => new Response("<html>outage</html>", { status: 502 }))
    )

    await expect(
      client.sendLegacyText({
        pageId: "page",
        pageAccessToken: "page-token",
        recipientId: "psid",
        text: "hello",
      })
    ).resolves.toEqual({
      ok: false,
      status: 502,
      data: null,
      error: "Meta returned HTTP 502",
      reason: null,
    })
  })

  it("maps a provider body to an allowlisted rejection message", async () => {
    const client = new MetaClient(
      "app",
      "secret",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "raw body https://example.test?access_token=SECRET",
              },
            }),
            { status: 400 }
          )
      )
    )

    const result = await client.sendText({
      pageAccessToken: "page-token",
      recipientId: "psid",
      text: "hello",
    })

    expect(result).toMatchObject({
      ok: false,
      kind: "rejected",
      message: "Meta rejected the message.",
    })
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|access_token|example\\.test/u
    )
  })
})
