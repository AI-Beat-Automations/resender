import crypto from "crypto"

import { after, type NextRequest } from "next/server"

import { ingestInstagramWebhookPayload } from "@/lib/inbound/inbound-ingestion"
import { describeWebhookEnvelope } from "@/lib/inbound/webhook-envelope"
import { verifyMetaSignature } from "@/lib/inbound/webhook-signature"
import { describeError, log } from "@/lib/observability/logger"

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

const ROUTE = "/api/meta/instagram/webhook"

// GET = verificación del challenge, al registrar el webhook en Meta.
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
      channel: "instagram",
      route: ROUTE,
    })
    return new Response(q.get("hub.challenge"), { status: 200 })
  }
  // Sube a `warn`: un handshake rechazado significa que el verify token del
  // panel de Meta y el del entorno no coinciden, y el webhook no va a quedar
  // registrado. No es operación normal.
  log({
    entrypoint: "route",
    action: "webhook_verify",
    outcome: "dropped",
    reason: "verify_token_mismatch",
    level: "warn",
    channel: "instagram",
    route: ROUTE,
    status: 403,
  })
  return new Response("forbidden", { status: 403 })
}

// POST = recepción de eventos. Responde 200 SIEMPRE y rápido: si no, Meta
// reintenta y termina desactivando el webhook.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const raw = await request.text()
  // Se genera antes del chequeo de firma para que hasta un payload rechazado
  // tenga id: es lo que después ata el sobre, sus N eventos y sus N entregas.
  const requestId = crypto.randomUUID()

  // Valida que el evento viene de Meta: HMAC-SHA256 del **body crudo** con el
  // App Secret de Instagram. Tiene que ser el texto tal cual llegó: reserializar
  // el JSON cambia el orden o el espaciado y la firma deja de coincidir.
  const signature = verifyMetaSignature({
    raw,
    header: request.headers.get("x-hub-signature-256"),
    appSecret: APP_SECRET,
  })
  if (!signature.ok) {
    // **La línea que justifica todo este trabajo.** Con el App Secret
    // equivocado la ruta rechazaba todo con 401 sin registrar nada, y el
    // síntoma se veía igual que «no llega nada» — que es exactamente el agujero
    // del que se venía saliendo.
    log({
      entrypoint: "route",
      action: "webhook_receive",
      outcome: "dropped",
      reason: signature.reason,
      level: "warn",
      requestId,
      channel: "instagram",
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
      channel: "instagram",
      route: ROUTE,
      errorMessage: describeError(error),
    })
    return Response.json({ ok: true })
  }

  // Conteos del sobre, sin nada de contenido. Es lo que distingue «Meta no
  // mandó nada» de «mandó algo y el parser no lo reconoció».
  const envelope = describeWebhookEnvelope(body)

  // La ingesta entera va **fuera de la respuesta**, igual que en WhatsApp: son
  // ~8 round-trips a Neon por evento y Meta solo espera el 200. Con la ingesta
  // inline, un sobre de veinte eventos tardaba segundos en contestar y Meta
  // empieza a reintentar —y a marcar el webhook como lento— a partir de ahí.
  // `after()` en OpenNext es `waitUntil`: el trabajo corre igual, pero después
  // de que Meta ya tiene su 200. La firma ya está verificada arriba, así que lo
  // que se difiere es solo trabajo nuestro, nunca la decisión de aceptar.
  after(async () => {
    try {
      const ingested = await ingestInstagramWebhookPayload(body, requestId)

      const nonEmpty = envelope.messagingCount + envelope.changeCount > 0
      log({
        entrypoint: "after",
        action: "webhook_receive",
        // Un sobre con eventos que produce cero ingestas no es normal: o el
        // parser dejó de reconocer el payload, o todo lo que vino se descartó
        // —y en ese caso hay una línea `inbound_ingest_dropped` con el mismo
        // `requestId` que dice por qué—.
        ...(ingested.length === 0 && nonEmpty
          ? {
              outcome: "dropped" as const,
              reason: "no_events_in_payload" as const,
              level: "warn" as const,
            }
          : { outcome: "ok" as const }),
        requestId,
        channel: "instagram",
        route: ROUTE,
        count: ingested.length,
        ...envelope,
      })

      // El reenvío al webhook del tenant: el endpoint del cliente puede tardar
      // segundos, y un push que falle no debe frenar a los demás del sobre.
      await Promise.all(
        ingested.map(async (item) => {
          try {
            await item.pushJob()
          } catch (error) {
            // Un throw acá no va a ningún lado: la request ya respondió y
            // nadie escucha. `recordDelivery` hace un insert que puede fallar,
            // así que sin esta línea sería un descarte silencioso más.
            log({
              entrypoint: "after",
              action: "webhook_delivery",
              outcome: "failed",
              reason: "internal_error",
              requestId,
              channel: "instagram",
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
        channel: "instagram",
        route: ROUTE,
        ...envelope,
        errorMessage: describeError(error),
      })
    }
  })

  return Response.json({ ok: true })
}
