import { type NextRequest } from "next/server"

import { auth } from "@/auth"
import { getActivePageTokenForTenant } from "@/lib/pages/page-registry"

const GRAPH = "https://graph.facebook.com/v23.0"

// Envía una respuesta al contacto. Body: { pageId, recipientId, reply }.
// El page access token se resuelve en el servidor por pageId (no viaja en el curl).
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const { pageId, recipientId, reply } = body as Record<string, unknown>

  if (
    typeof pageId !== "string" ||
    typeof recipientId !== "string" ||
    typeof reply !== "string" ||
    !pageId.trim() ||
    !recipientId.trim() ||
    !reply.trim()
  ) {
    return Response.json(
      { error: "missing pageId, recipientId or reply" },
      { status: 400 }
    )
  }

  const token = await getActivePageTokenForTenant(session.user.id, pageId.trim())
  if (!token) {
    return Response.json(
      {
        error: "page is not connected for this tenant",
      },
      { status: 404 }
    )
  }

  // Ventana de 24h: messaging_type RESPONSE solo funciona dentro de las 24h del
  // último mensaje del usuario. Fuera de eso se requiere el tag human_agent.
  const res = await fetch(
    `${GRAPH}/${pageId.trim()}/messages?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId.trim() },
        messaging_type: "RESPONSE",
        message: { text: reply.trim() },
      }),
    }
  )

  const data = await res.json()
  return Response.json(data, { status: res.status })
}
