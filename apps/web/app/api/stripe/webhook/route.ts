import { proxyBackendRequest } from "@/lib/backend/backend-request-proxy"

export const runtime = "nodejs"

export function POST(request: Request): Promise<Response> {
  return proxyBackendRequest(request, "/webhooks/stripe")
}
