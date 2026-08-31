import { toNextJsHandler } from "better-auth/next-js"

import { getAuth } from "@/lib/auth/auth"
import { allowAuthAttempt } from "@/lib/auth/rate-limit"

// Superficie HTTP de Better Auth. Reemplaza a `[...nextauth]`: el catch-all se
// llama `all` porque la librería monta bajo `/api/auth/*` todos sus endpoints
// (`sign-in/email`, `sign-out`, `get-session`, …), no solo el callback.
export const runtime = "nodejs"

// `getAuth()` es perezoso a propósito (ver `lib/auth/auth.ts`): el handler se
// resuelve por request para que el contexto no se construya durante el build.
const handlers = toNextJsHandler((request: Request) =>
  getAuth().handler(request)
)

export const GET = handlers.GET

// El `POST` es la puerta pública: `sign-in/email` y `sign-up/email` viven acá y
// se pueden martillar con `curl` salteándose por completo los server actions,
// que son la otra puerta con límite. Por eso el rate limit va envolviendo el
// handler y no dentro de él.
export async function POST(request: Request) {
  if (!(await allowAuthAttempt(request.headers))) {
    return Response.json(
      { code: "TOO_MANY_REQUESTS", message: "Too many requests" },
      { status: 429 }
    )
  }

  return handlers.POST(request)
}
