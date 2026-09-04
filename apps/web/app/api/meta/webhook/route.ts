import crypto from "crypto"

import { after, type NextRequest } from "next/server"

import { ingestMetaWebhookPayload } from "@/lib/inbound/inbound-ingestion"
import { describeWebhookEnvelope } from "@/lib/inbound/webhook-envelope"
import { verifyMetaSignature } from "@/lib/inbound/webhook-signature"
import { describeError, log } from "@/lib/observability/logger"

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!
const APP_SECRET = process.env.META_APP_SECRET!

const ROUTE = "/api/meta/webhook"

// GET = verificación del challenge (al registrar el webhook en Meta)
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  if (
    q.get("hub.mode") === "subscribe" &&
    q.get("hub.verify_token") === VERIFY_TOKEN
  ) {
    log({
      entrypoint: "route",
      action: "webhook_verify",
      outcome: "ok",
      channel: "messenger",
      route: ROUTE,
    })
    return new Response(q.get("hub.challenge"), { status: 200 })
  }
  log({
    entrypoint: "route",
    action: "webhook_verify",
    outcome: "dropped",
    reason: "verify_token_mismatch",
    level: "warn",
    channel: "messenger",
    route: ROUTE,
    status: 403,
  })
  return new Response("forbidden", { status: 403 })
}

// POST = recepción de eventos. Responde 200 SIEMPRE y rápido (si no, Meta
// reintenta y termina desactivando el webhook).
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const raw = await request.text()
  // Antes del chequeo de firma, para que hasta un payload rechazado tenga id.
  const requestId = crypto.randomUUID()

  // valida que el evento viene de Meta: HMAC-SHA256 del body con el App Secret
  const signature = verifyMetaSignature({
    raw,
    header: request.headers.get("x-hub-signature-256"),
    appSecret: APP_SECRET,
  })
  if (!signature.ok) {
    log({
      entrypoint: "route",
      action: "webhook_receive",
      outcome: "dropped",
      reason: signature.reason,
      level: "warn",
      requestId,
      channel: "messenger",
      route: ROUTE,
      status: 401,
    })
    return new Response("bad signature", { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch (error) {
    log({
      entrypoint: "route",
      action: "webhook_receive",
      outcome: "failed",
      reason: "invalid_json",
      requestId,
      channel: "messenger",
      route: ROUTE,
      errorMessage: describeError(error),
    })
    return Response.json({ ok: true })
  }

  const envelope = describeWebhookEnvelope(body)

  // La ingesta entera va **fuera de la respuesta**, igual que en Instagram y
  // en WhatsApp: son ~8 round-trips a Neon por evento y Meta solo espera el
  // 200. `after()` en OpenNext es `waitUntil`: el trabajo corre igual, pero
  // después de que Meta ya tiene su 200. La firma ya está verificada arriba,
  // así que lo que se difiere es solo trabajo nuestro, nunca la decisión de
  // aceptar.
  after(async () => {
    try {
      const ingested = await ingestMetaWebhookPayload(body, requestId)

      const nonEmpty = envelope.messagingCount + envelope.changeCount > 0
      log({
        entrypoint: "after",
        action: "webhook_receive",
        ...(ingested.length === 0 && nonEmpty
          ? {
              outcome: "dropped" as const,
              reason: "no_events_in_payload" as const,
              level: "warn" as const,
            }
          : { outcome: "ok" as const }),
        requestId,
        channel: "messenger",
        route: ROUTE,
        count: ingested.length,
        ...envelope,
      })

      await Promise.all(
        ingested.map(async (item) => {
          try {
            await item.pushJob()
          } catch (error) {
            // Un throw acá no va a ningún lado: la request ya respondió.
            log({
              entrypoint: "after",
              action: "webhook_delivery",
              outcome: "failed",
              reason: "internal_error",
              requestId,
              channel: "messenger",
              errorMessage: describeError(error),
            })
          }
        })
      )
    } catch (error) {
      log({
        entrypoint: "after",
        action: "webhook_receive",
        outcome: "failed",
        reason: "internal_error",
        requestId,
        channel: "messenger",
        route: ROUTE,
        ...envelope,
        errorMessage: describeError(error),
      })
    }
  })

  return Response.json({ ok: true })
}
