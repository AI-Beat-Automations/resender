import { type NextRequest } from "next/server"

import { auth } from "@/auth"
import { getPageToken } from "@/lib/page-store"

const GRAPH = "https://graph.facebook.com/v23.0"

// Envía una respuesta al contacto. Body: { pageId, recipientId, reply }.
// El page access token se resuelve en el servidor por pageId (no viaja en el curl).
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const { pageId, recipientId, reply } = await request.json()

  if (!pageId || !recipientId || !reply) {
    return Response.json(
      { error: "missing pageId, recipientId or reply" },
      { status: 400 }
    )
  }

  const token = getPageToken(pageId)
  if (!token) {
    return Response.json(
      {
        error:
          "page token no está en memoria — reconecta la página (buffer temporal; Fase 3 lo persiste)",
      },
      { status: 404 }
    )
  }

  // Ventana de 24h: messaging_type RESPONSE solo funciona dentro de las 24h del
  // último mensaje del usuario. Fuera de eso se requiere el tag human_agent.
  const res = await fetch(
    `${GRAPH}/${pageId}/messages?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text: reply },
      }),
    }
  )

  const data = await res.json()
  return Response.json(data, { status: res.status })
}
