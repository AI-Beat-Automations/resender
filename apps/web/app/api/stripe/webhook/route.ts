import { proxyProviderCallback } from "@/lib/backend/provider-callback-proxy"

export const runtime = "nodejs"

export function POST(request: Request): Promise<Response> {
  return proxyProviderCallback(request, "/webhooks/stripe")
}
