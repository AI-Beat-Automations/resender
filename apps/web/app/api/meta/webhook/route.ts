import crypto from "crypto"

import { type NextRequest } from "next/server"

import { addMessage } from "@/lib/message-store"

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!
const APP_SECRET = process.env.META_APP_SECRET!

// GET = verificación del challenge (al registrar el webhook en Meta)
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  if (
    q.get("hub.mode") === "subscribe" &&
    q.get("hub.verify_token") === VERIFY_TOKEN
  ) {
    return new Response(q.get("hub.challenge"), { status: 200 })
  }
  return new Response("forbidden", { status: 403 })
}

// POST = recepción de eventos. Responde 200 SIEMPRE y rápido (si no, Meta
// reintenta y termina desactivando el webhook).
export async function POST(request: NextRequest) {
  const raw = await request.text()

  // valida que el evento viene de Meta: HMAC-SHA256 del body con el App Secret
  const sig = request.headers.get("x-hub-signature-256") ?? ""
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex")
  if (!safeEqual(sig, expected)) {
    return new Response("bad signature", { status: 401 })
  }

  try {
    const body = JSON.parse(raw)
    for (const entry of body.entry ?? []) {
      const pageId = entry.id // llave de ruteo -> tenant (futuro)
      for (const ev of entry.messaging ?? []) {
        const text = ev.message?.text
        if (!text) continue // ignoramos delivery/read/postbacks por ahora
        addMessage({
          id: ev.message?.mid ?? crypto.randomUUID(),
          pageId,
          senderId: ev.sender?.id ?? "unknown",
          text,
          at: ev.timestamp ?? Date.now(),
        })
      }
    }
  } catch (e) {
    console.error("webhook parse error", e)
  }

  return Response.json({ ok: true })
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
