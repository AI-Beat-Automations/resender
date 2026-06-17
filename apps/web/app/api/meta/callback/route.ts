import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import {
  APP_URL,
  STATE_COOKIE,
  exchangeCodeForPages,
  subscribeToWebhook,
} from "@/lib/meta"
import { setPageToken } from "@/lib/page-store"

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

    // guarda los page tokens en memoria para poder responder (/api/meta/send).
    // TEMPORAL: la Fase 3 los persiste cifrados en Neon.
    for (const p of pages) setPageToken(p.pageId, p.pageAccessToken)

    // suscribe cada página al webhook del app (messages, messaging_postbacks)
    await Promise.all(
      pages.map((p) => subscribeToWebhook(p.pageId, p.pageAccessToken))
    )

    // TODO Fase 3: guardar {pageId, name, pageAccessToken, tenantId} en Neon
    console.log(
      "connected pages",
      pages.map((p) => ({ pageId: p.pageId, name: p.name }))
    )

    // solo lo público (id + name) para mostrar en la home; los tokens se quedan
    // en el servidor (Fase 3: persistir en Neon)
    const publicPages = pages.map((p) => ({ id: p.pageId, name: p.name }))
    connections.searchParams.set("meta", "connected")
    connections.searchParams.set("pages", JSON.stringify(publicPages))
    const res = NextResponse.redirect(connections)
    res.cookies.delete(STATE_COOKIE)
    return res
  } catch {
    return fail("exchange_failed")
  }
}
