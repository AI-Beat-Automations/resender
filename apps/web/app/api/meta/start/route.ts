import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { getProductAccess } from "@/lib/backend/backend"
import { productPageRedirect } from "@/lib/access/product-gates"
import {
  buildMetaDialogUrl,
  configuredAppOrigin,
  META_STATE_COOKIE,
  metaStateCookieOptions,
  serializeMetaState,
} from "@/lib/meta/oauth"

// Arranca el OAuth: genera un `state` (CSRF), lo guarda en cookie httpOnly y
// redirige al diálogo de Meta. El botón "Conectar Facebook" apunta aquí.
export const runtime = "nodejs"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", configuredAppOrigin()))
  }

  const access = await getProductAccess({ userId: session.user.id })
  const destination = productPageRedirect(access)
  if (destination) {
    return NextResponse.redirect(new URL(destination, configuredAppOrigin()))
  }

  const state = crypto.randomUUID()

  const res = NextResponse.redirect(buildMetaDialogUrl(state))
  res.cookies.set(
    META_STATE_COOKIE,
    serializeMetaState(state),
    metaStateCookieOptions()
  )
  return res
}
