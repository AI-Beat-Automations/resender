import { proxyBackendRequest } from "@/lib/backend/backend-request-proxy"

export const runtime = "nodejs"

export function GET(request: Request): Promise<Response> {
  return proxyBackendRequest(request, "/webhooks/meta")
}

export function POST(request: Request): Promise<Response> {
  return proxyBackendRequest(request, "/webhooks/meta")
}
