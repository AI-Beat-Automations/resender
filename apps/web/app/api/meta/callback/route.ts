import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import {
  assertSecretEncryptionConfigured,
  SecretEncryptionConfigError,
} from "@/lib/crypto/encryption"
import {
  APP_URL,
  STATE_COOKIE,
  exchangeCodeForPages,
  subscribePagesToWebhook,
  WebhookSubscriptionError,
} from "@/lib/meta"
import {
  assertPagesConnectable,
  connectAuthorizedPages,
  PageOwnershipError,
} from "@/lib/pages/page-registry"

// Meta redirige aquí con ?code=...&state=... tras aprobar el diálogo.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", APP_URL))
  }

  const params = request.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")

  const connections = new URL("/connections", APP_URL)
  const fail = (reason: string) => {
    connections.searchParams.set("meta", "error")
    connections.searchParams.set("reason", reason)
    const res = NextResponse.redirect(connections)
    res.cookies.delete(STATE_COOKIE)
    return res
  }

  // el usuario canceló o Meta devolvió error
  if (error || !code) return fail(error ?? "missing_code")

  // CSRF: el state del query debe coincidir con la cookie que sembró /start
  const expected = request.cookies.get(STATE_COOKIE)?.value
  if (!state || !expected || state !== expected) return fail("state_mismatch")

  try {
    const pages = await exchangeCodeForPages(code)
    assertSecretEncryptionConfigured()
    await assertPagesConnectable(session.user.id, pages)
    await subscribePagesToWebhook(pages)

    const connectedPages = await connectAuthorizedPages(session.user.id, pages)

    console.log(
      "connected pages",
      connectedPages.map((p) => ({ pageId: p.metaPageId, name: p.name }))
    )

    // Solo exponemos id + name en la URL; el token queda cifrado en Postgres.
    const publicPages = connectedPages.map((p) => ({
      id: p.metaPageId,
      name: p.name,
    }))
    connections.searchParams.set("meta", "connected")
    connections.searchParams.set("pages", JSON.stringify(publicPages))
    const res = NextResponse.redirect(connections)
    res.cookies.delete(STATE_COOKIE)
    return res
  } catch (error) {
    if (error instanceof PageOwnershipError) {
      return fail(`page_owned:${error.metaPageId}`)
    }
    if (error instanceof WebhookSubscriptionError) {
      console.error("webhook subscription failed", {
        pageIds: error.failedPageIds,
      })
      return fail("webhook_subscription_failed")
    }
    console.error("meta connection failed", error)
    if (error instanceof SecretEncryptionConfigError) {
      return fail("configuration_failed")
    }
    return fail("exchange_failed")
  }
}
