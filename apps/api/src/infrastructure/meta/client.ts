import { ContractError } from "@workspace/contracts"

import { META_TIMEOUT_MS } from "../../config"

const GRAPH_VERSION = "v23.0"
const SUBSCRIBED_FIELDS =
  "messages,messaging_postbacks,messaging_policy_enforcement"

export type MetaPage = {
  id: string
  name: string
  accessToken: string
}

export type MetaSendResult =
  | { ok: true; messageId: string; response: unknown }
  | {
      ok: false
      kind: "invalid_token" | "rejected" | "unavailable"
      message: string
      response: unknown
    }

export class MetaClient {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async exchangeAuthorizationCode(input: {
    code: string
    redirectUri: string
  }): Promise<string> {
    const shortLived = await this.graph<{ access_token?: unknown }>(
      "/oauth/access_token",
      {
        client_id: this.appId,
        client_secret: this.appSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
      }
    )
    const shortToken = requiredString(
      shortLived.access_token,
      "Meta did not return an access token."
    )
    const longLived = await this.graph<{ access_token?: unknown }>(
      "/oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: this.appId,
        client_secret: this.appSecret,
        fb_exchange_token: shortToken,
      }
    )
    return requiredString(
      longLived.access_token,
      "Meta did not return a long-lived access token."
    )
  }

  async listPages(userAccessToken: string): Promise<MetaPage[]> {
    const pages: MetaPage[] = []
    let nextUrl: string | null = graphUrl("/me/accounts", {
      fields: "id,name,access_token",
      limit: "100",
      access_token: userAccessToken,
    })

    for (let page = 0; nextUrl && page < 20; page += 1) {
      const response: {
        data?: unknown
        paging?: { next?: unknown }
      } = await this.requestJson(nextUrl)
      if (Array.isArray(response.data)) {
        for (const value of response.data) {
          if (!value || typeof value !== "object") continue
          const candidate = value as Record<string, unknown>
          if (
            typeof candidate.id === "string" &&
            typeof candidate.name === "string" &&
            typeof candidate.access_token === "string"
          ) {
            pages.push({
              id: candidate.id,
              name: candidate.name,
              accessToken: candidate.access_token,
            })
          }
        }
      }
      nextUrl =
        typeof response.paging?.next === "string"
          ? validateGraphPagingUrl(response.paging.next)
          : null
    }
    return pages
  }

  async subscribePage(pageId: string, pageAccessToken: string): Promise<void> {
    await this.graph(
      `/${encodeURIComponent(pageId)}/subscribed_apps`,
      {
        subscribed_fields: SUBSCRIBED_FIELDS,
        access_token: pageAccessToken,
      },
      "POST"
    )
  }

  async unsubscribePage(
    pageId: string,
    pageAccessToken: string
  ): Promise<void> {
    await this.graph(
      `/${encodeURIComponent(pageId)}/subscribed_apps`,
      { access_token: pageAccessToken },
      "DELETE"
    )
  }

  async sendText(input: {
    pageAccessToken: string
    recipientId: string
    text: string
  }): Promise<MetaSendResult> {
    const url = graphUrl("/me/messages", {
      access_token: input.pageAccessToken,
    })
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messaging_type: "RESPONSE",
          recipient: { id: input.recipientId },
          message: { text: input.text },
        }),
      })
      const body = await parseJson(response)
      if (response.ok) {
        const messageId =
          body &&
          typeof body === "object" &&
          typeof (body as Record<string, unknown>).message_id === "string"
            ? (body as Record<string, string>).message_id
            : null
        return messageId
          ? { ok: true, messageId, response: body }
          : {
              ok: false,
              kind: "unavailable",
              message: "Meta returned an incomplete response.",
              response: body,
            }
      }
      const error = metaError(body)
      return {
        ok: false,
        kind:
          error.code === 190
            ? "invalid_token"
            : response.status >= 500 || response.status === 429
              ? "unavailable"
              : "rejected",
        message: error.message,
        response: body,
      }
    } catch (error) {
      return {
        ok: false,
        kind: "unavailable",
        message:
          error instanceof Error ? error.message : "Meta request failed.",
        response: null,
      }
    }
  }

  private async graph<T>(
    path: string,
    parameters: Record<string, string>,
    method: "GET" | "POST" | "DELETE" = "GET"
  ): Promise<T> {
    const url = graphUrl(path, method === "POST" ? {} : parameters)
    let response: Response
    try {
      response = await this.fetcher(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
        ...(method !== "POST"
          ? {}
          : {
              headers: {
                "content-type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams(parameters),
            }),
      })
    } catch {
      throw providerNetworkError()
    }
    const body = await parseJson(response)
    if (!response.ok) {
      const error = metaError(body)
      throw new ContractError({
        code:
          response.status >= 500 || response.status === 429
            ? "provider_unavailable"
            : "provider_rejected",
        message: error.message,
        status: response.status >= 500 || response.status === 429 ? 502 : 422,
      })
    }
    return body as T
  }

  private async requestJson<T>(url: string): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
      })
    } catch {
      throw providerNetworkError()
    }
    const body = await parseJson(response)
    if (!response.ok) {
      const error = metaError(body)
      throw new ContractError({
        code: "provider_unavailable",
        message: error.message,
        status: 502,
      })
    }
    return body as T
  }
}

function graphUrl(path: string, parameters: Record<string, string>): string {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}${path}`)
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function validateGraphPagingUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidPagingUrl()
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "graph.facebook.com" ||
    !url.pathname.startsWith(`/${GRAPH_VERSION}/`)
  ) {
    throw invalidPagingUrl()
  }
  return url.toString()
}

function invalidPagingUrl(): ContractError {
  return new ContractError({
    code: "provider_unavailable",
    message: "Meta returned an invalid pagination URL.",
    status: 502,
  })
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: { message: "Provider returned a non-JSON response." } }
  }
}

function metaError(value: unknown): { code: number | null; message: string } {
  if (!value || typeof value !== "object") {
    return { code: null, message: "Meta request failed." }
  }
  const error = (value as Record<string, unknown>).error
  if (!error || typeof error !== "object") {
    return { code: null, message: "Meta request failed." }
  }
  const record = error as Record<string, unknown>
  return {
    code: typeof record.code === "number" ? record.code : null,
    message:
      typeof record.message === "string"
        ? record.message
        : "Meta request failed.",
  }
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value) {
    throw new ContractError({
      code: "provider_unavailable",
      message,
      status: 502,
    })
  }
  return value
}

function providerNetworkError(): ContractError {
  return new ContractError({
    code: "provider_unavailable",
    message: "Meta is temporarily unavailable.",
    status: 502,
  })
}
