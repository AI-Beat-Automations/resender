import "server-only"

import { getCloudflareContext } from "@opennextjs/cloudflare"

export type ProviderCallbackPath = "/webhooks/meta" | "/webhooks/stripe"

const UNAVAILABLE_RESPONSE_BODY = "service unavailable"
const INTERNAL_BACKEND_ORIGIN = "https://backend.internal"

export async function proxyProviderCallback(
  request: Request,
  pathname: ProviderCallbackPath
): Promise<Response> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const backend: CloudflareEnv["BACKEND"] | undefined = env.BACKEND
    if (!backend) return unavailableResponse()

    const upstreamUrl = new URL(pathname, INTERNAL_BACKEND_ORIGIN)
    upstreamUrl.search = new URL(request.url).search

    return await backend.fetch(new Request(upstreamUrl, request))
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
