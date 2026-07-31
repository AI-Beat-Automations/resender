import "server-only"

import { getCloudflareContext } from "@opennextjs/cloudflare"

export type BackendProxyPath =
  | "/webhooks/meta"
  | "/webhooks/stripe"
  | "/internal/legacy/meta/send"

const UNAVAILABLE_RESPONSE_BODY = "service unavailable"
const INTERNAL_BACKEND_ORIGIN = "https://backend.internal"

export async function proxyBackendRequest(
  request: Request,
  pathname: BackendProxyPath
): Promise<Response> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const backend: CloudflareEnv["BACKEND"] | undefined = env.BACKEND
    if (!backend) return unavailableResponse()

    const upstreamUrl = new URL(pathname, INTERNAL_BACKEND_ORIGIN)
    upstreamUrl.search = new URL(request.url).search

    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body
      init.duplex = "half"
    }

    const response: unknown = await backend.fetch(upstreamUrl.toString(), init)
    if (response instanceof Response) return response

    // `next dev` and Miniflare have different Web API realms. Preserve the
    // binding response stream while presenting Next with its own Response.
    const foreignResponse = response as Pick<
      Response,
      "body" | "headers" | "status" | "statusText"
    >
    return new Response(foreignResponse.body, {
      status: foreignResponse.status,
      statusText: foreignResponse.statusText,
      headers: foreignResponse.headers,
    })
  } catch {
    return unavailableResponse()
  }
}

function unavailableResponse(): Response {
  return new Response(UNAVAILABLE_RESPONSE_BODY, {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}
