import crypto from "crypto"

import { after, type NextRequest } from "next/server"

import { ingestInstagramWebhookPayload } from "@/lib/inbound/inbound-ingestion"

// Webhook de Instagram. Ruta propia y no una rama dentro de `/api/meta/webhook`
// por una razón concreta: **el secreto que firma es otro**.
//
// `INSTAGRAM_APP_SECRET` es distinto de `META_APP_SECRET` aunque los dos vivan
// en la misma app de Meta. Compartir la ruta obligaría a adivinar con cuál
// verificar cada payload —o a probar los dos, que es peor— y firmar un webhook
// de Instagram con el secreto de Facebook es el error de configuración más
// común de esta integración. Rutas separadas hacen que la pregunta no exista.
//
// El verify token también es propio: cada webhook se registra por separado en
// el panel de Meta.
const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN!
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET!

// GET = verificación del challenge, al registrar el webhook en Meta.
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

// POST = recepción de eventos. Responde 200 SIEMPRE y rápido: si no, Meta
// reintenta y termina desactivando el webhook.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const raw = await request.text()

  // Valida que el evento viene de Meta: HMAC-SHA256 del **body crudo** con el
  // App Secret de Instagram. Tiene que ser el texto tal cual llegó: reserializar
  // el JSON cambia el orden o el espaciado y la firma deja de coincidir.
  const sig = request.headers.get("x-hub-signature-256") ?? ""
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex")
  if (!safeEqual(sig, expected)) {
    return new Response("bad signature", { status: 401 })
  }

  try {
    const body = JSON.parse(raw)
    const ingested = await ingestInstagramWebhookPayload(body)

    // El reenvío al webhook del tenant va fuera de la respuesta: Meta solo
    // espera el 200, y el endpoint del cliente puede tardar segundos.
    for (const item of ingested) {
      after(async () => {
        await item.pushJob()
      })
    }
  } catch (e) {
    console.error("instagram webhook parse error", e)
  }

  return Response.json({ ok: true })
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
