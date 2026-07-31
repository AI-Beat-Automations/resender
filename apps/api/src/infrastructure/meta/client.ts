import { ContractError } from "@workspace/contracts"

import { META_TIMEOUT_MS } from "../../config"

const GRAPH_VERSION = "v23.0"
const SUBSCRIBED_FIELDS =
  "messages,messaging_postbacks,messaging_policy_enforcement"
const META_INVALID_TOKEN_MESSAGE =
  "The Page access token is invalid. Reconnect the Page."
const META_REJECTED_MESSAGE = "Meta rejected the message."
const META_UNAVAILABLE_MESSAGE = "Meta is temporarily unavailable."

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

export type LegacyMetaSendResult = {
  ok: boolean
  status: number
  data: unknown
  error: string | null
  reason: string | null
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
          ? {
              ok: true,
              messageId,
              response: { message_id: messageId },
            }
          : {
              ok: false,
              kind: "unavailable",
              message: META_UNAVAILABLE_MESSAGE,
              response: null,
            }
      }
      const error = metaError(body)
      const kind =
        error.code === 190
          ? "invalid_token"
          : response.status >= 500 || response.status === 429
            ? "unavailable"
            : "rejected"
      return {
        ok: false,
        kind,
        message:
          kind === "invalid_token"
            ? META_INVALID_TOKEN_MESSAGE
            : kind === "unavailable"
              ? META_UNAVAILABLE_MESSAGE
              : META_REJECTED_MESSAGE,
        response: null,
      }
    } catch {
      return {
        ok: false,
        kind: "unavailable",
        message: META_UNAVAILABLE_MESSAGE,
        response: null,
      }
    }
  }

  async sendLegacyText(input: {
    pageId: string
    pageAccessToken: string
    recipientId: string
    text: string
  }): Promise<LegacyMetaSendResult> {
    const url = graphUrl(`/${encodeURIComponent(input.pageId)}/messages`, {
      access_token: input.pageAccessToken,
    })
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: { id: input.recipientId },
          messaging_type: "RESPONSE",
          message: { text: input.text },
        }),
      })
      const data: unknown = await response.json().catch(() => null)
      const providerError = extractMetaErrorMessage(data)
      return {
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok
          ? null
          : (providerError ?? `Meta returned HTTP ${response.status}`),
        reason: response.ok ? null : explainLegacyMetaError(data),
      }
    } catch {
      return {
        ok: false,
        status: 502,
        data: null,
        // Fetch errors can embed the complete URL, including access_token.
        error: "Meta request failed",
        reason:
          "Could not reach Meta's Send API (network error or timeout). Retry shortly.",
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
      throw new ContractError({
        code:
          response.status >= 500 || response.status === 429
            ? "provider_unavailable"
            : "provider_rejected",
        message:
          response.status >= 500 || response.status === 429
            ? META_UNAVAILABLE_MESSAGE
            : "Meta rejected the request.",
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
      throw new ContractError({
        code: "provider_unavailable",
        message: META_UNAVAILABLE_MESSAGE,
        status: 502,
      })
    }
    return body as T
  }
}

export function explainLegacyMetaError(data: unknown): string | null {
  const code = extractMetaErrorCode(data)
  if (code === null) return null
  const subcode = extractMetaErrorSubcode(data)

  if (code === 190) {
    return "The Page access token expired or was revoked. Reconnect the Page in Resender."
  }
  if (code === 10 && subcode === 2018278) {
    return "Messenger's 24-hour window is closed: this contact hasn't messaged the Page in the last 24 hours, so Meta rejects new messages until they write again."
  }
  if (code === 10) {
    return "Meta permission error: the app or Page is missing the pages_messaging permission for this send."
  }
  if (code === 551) {
    return "This person isn't available: they may have blocked the Page, deleted the conversation, or deactivated their account."
  }
  if (code === 100 && subcode === 2018001) {
    return "No matching user found: the recipient ID (PSID) doesn't belong to this Page."
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return "Meta rate limit reached for this app or Page. Retry later."
  }
  if (code === 368) {
    return "The Page is temporarily blocked from sending messages due to a policy violation on Meta's side."
  }
  return null
}

export function extractMetaErrorCode(data: unknown): number | null {
  const code = metaErrorProperty(data, "code")
  if (typeof code === "number") return code
  if (typeof code === "string" && code.trim().length > 0) {
    const parsed = Number(code)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function extractMetaMessageId(data: unknown): string | null {
  const messageId = objectProperty(data, "message_id")
  return typeof messageId === "string" ? messageId : null
}

function extractMetaErrorMessage(data: unknown): string | null {
  const message = metaErrorProperty(data, "message")
  return typeof message === "string" && message.trim().length > 0
    ? message.trim()
    : null
}

function extractMetaErrorSubcode(data: unknown): number | null {
  const subcode = metaErrorProperty(data, "error_subcode")
  return typeof subcode === "number" ? subcode : null
}

function metaErrorProperty(data: unknown, property: string): unknown {
  return objectProperty(objectProperty(data, "error"), property)
}

function objectProperty(value: unknown, property: string): unknown {
  if (!value || typeof value !== "object") return undefined
  return Reflect.get(value, property)
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

function metaError(value: unknown): { code: number | null } {
  if (!value || typeof value !== "object") {
    return { code: null }
  }
  const error = (value as Record<string, unknown>).error
  if (!error || typeof error !== "object") {
    return { code: null }
  }
  const record = error as Record<string, unknown>
  return {
    code: typeof record.code === "number" ? record.code : null,
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
    message: META_UNAVAILABLE_MESSAGE,
    status: 502,
  })
}
