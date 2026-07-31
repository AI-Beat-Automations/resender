import { proxyBackendRequest } from "@/lib/backend/backend-request-proxy"

export const runtime = "nodejs"

// Deprecated compatibility bridge. The API Worker exclusively owns auth,
// tenant/provider resolution, persistence, quota and the Meta side effect.
export function POST(request: Request): Promise<Response> {
  return proxyBackendRequest(request, "/internal/legacy/meta/send")
}
