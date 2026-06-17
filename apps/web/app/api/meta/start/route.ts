import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { STATE_COOKIE, buildDialogUrl } from "@/lib/meta"

// Arranca el OAuth: genera un `state` (CSRF), lo guarda en cookie httpOnly y
// redirige al diálogo de Meta. El botón "Conectar Facebook" apunta aquí.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  const state = crypto.randomUUID()

  const res = NextResponse.redirect(buildDialogUrl(state))
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // se envía en la navegación top-level de vuelta desde Meta
    path: "/",
    maxAge: 600, // 10 min
  })
  return res
}
