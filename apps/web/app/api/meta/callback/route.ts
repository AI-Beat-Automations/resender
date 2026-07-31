import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import {
  BackendRpcError,
  BackendProtocolError,
  BackendUnavailableError,
  exchangeMetaAuthorizationCode,
} from "@/lib/backend/backend"
import {
  configuredAppOrigin,
  expiredMetaStateCookieOptions,
  META_STATE_COOKIE,
  metaRedirectUri,
  validateMetaState,
} from "@/lib/meta/oauth"

// Meta redirige aquí con ?code=...&state=... tras aprobar el diálogo.
// El callback ya no conecta nada (ADR 0004): solo persiste cifrado el user
// access token de larga duración y manda a la pantalla de selección, donde el
// usuario elige qué páginas conectar. Así los page tokens de las páginas
// descartadas nunca llegan a la base.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const appOrigin = configuredAppOrigin()
  const session = await auth()
  if (!session?.user?.id) {
    return clearedRedirect("/login", appOrigin)
  }

  const params = request.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  let stateResult: ReturnType<typeof validateMetaState>
  try {
    stateResult = validateMetaState(
      state,
      request.cookies.get(META_STATE_COOKIE)?.value
    )
  } catch {
    return failedRedirect("backend_invalid", appOrigin)
  }
  if (stateResult !== "valid") {
    return failedRedirect(`state_${stateResult}`, appOrigin)
  }

  if (params.has("error")) {
    return failedRedirect("provider_cancelled", appOrigin)
  }
  if (!code) return failedRedirect("missing_code", appOrigin)

  // Consume the one-time browser state before crossing the service boundary.
  // The response is prepared and its cookie expired before the RPC begins.
  request.cookies.delete(META_STATE_COOKIE)
  const response = failedRedirect("backend_unavailable", appOrigin)

  try {
    await exchangeMetaAuthorizationCode(
      { userId: session.user.id },
      { code, redirectUri: metaRedirectUri() }
    )
    response.headers.set(
      "location",
      new URL("/connections/select", appOrigin).toString()
    )
    return response
  } catch (error) {
    if (error instanceof BackendRpcError) {
      if (error.classification.destination) {
        response.headers.set(
          "location",
          new URL(error.classification.destination, appOrigin).toString()
        )
      } else if (error.classification.kind === "provider") {
        response.headers.set(
          "location",
          failureUrl("meta_session_expired", appOrigin).toString()
        )
      } else {
        response.headers.set(
          "location",
          failureUrl("exchange_failed", appOrigin).toString()
        )
      }
      return response
    }
    if (error instanceof BackendUnavailableError) return response
    if (error instanceof BackendProtocolError) {
      response.headers.set(
        "location",
        failureUrl("backend_invalid", appOrigin).toString()
      )
      return response
    }
    response.headers.set(
      "location",
      failureUrl("exchange_failed", appOrigin).toString()
    )
    return response
  }
}

function failedRedirect(reason: string, appOrigin: URL) {
  return clearedRedirect(failureUrl(reason, appOrigin), appOrigin)
}

function failureUrl(reason: string, appOrigin: URL) {
  const url = new URL("/connections", appOrigin)
  url.searchParams.set("meta", "error")
  url.searchParams.set("reason", reason)
  return url
}

function clearedRedirect(destination: string | URL, appOrigin: URL) {
  const response = NextResponse.redirect(new URL(destination, appOrigin))
  response.cookies.set(META_STATE_COOKIE, "", expiredMetaStateCookieOptions())
  return response
}
