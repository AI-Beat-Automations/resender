import crypto from "crypto"

import { after, type NextRequest } from "next/server"

import { ingestWhatsappWebhookPayload } from "@/lib/inbound/inbound-ingestion"
import { describeWebhookEnvelope } from "@/lib/inbound/webhook-envelope"
import { verifyMetaSignature } from "@/lib/inbound/webhook-signature"
import { describeError, log } from "@/lib/observability/logger"

// Webhook de WhatsApp Cloud API. Ruta propia, con la misma forma que la de
// Instagram, y con **una diferencia que conviene leer despacio**:
//
//   - el verify token es propio (`WHATSAPP_VERIFY_TOKEN`), porque cada webhook
//     se registra por separado en el panel de Meta y cada registro pide el
//     suyo;
//   - pero el secreto que firma es `META_APP_SECRET`, **el mismo de
//     Messenger**. WhatsApp vive en la misma app de Meta que Facebook, no en
//     una aparte. Instagram es el caso raro —tiene su propio
//     `INSTAGRAM_APP_SECRET`—, no este.
//
// Firmar este webhook con un secreto propio inventado es el error de
// configuración que deja la ruta rechazando todo con 401 mientras el síntoma
// que se ve arriba es «no llega nada». De ahí el comentario y de ahí la línea
// de log del rechazo.
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!
const APP_SECRET = process.env.META_APP_SECRET!

const ROUTE = "/api/meta/whatsapp/webhook"

// El `object` del sobre. Un POST con cualquier otro valor no es de este canal:
// llega por una suscripción mal configurada en el panel de Meta, y procesarlo
// significaría resolver ids de otro producto contra `connected_pages`.
const WHATSAPP_OBJECT = "whatsapp_business_account"

// Techo del cuerpo, **antes de parsear**. El JSON más grande que Meta manda por
// acá es un chunk de historial de Coexistence —hasta mil mensajes de una
// conversación de seis meses—, y aun así queda muy por debajo. Lo que este
// límite corta es un cuerpo que no cabe en memoria del Worker: sin él, el
// `JSON.parse` de un payload absurdo tira la request entera y el único rastro
// sería un error de runtime sin canal ni motivo.
const MAX_BODY_BYTES = 5_000_000

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
      channel: "whatsapp",
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
    channel: "whatsapp",
    route: ROUTE,
    status: 403,
  })
  return new Response("forbidden", { status: 403 })
}

// POST = recepción de eventos. Responde 200 SIEMPRE y rápido: si no, Meta
// reintenta y termina desactivando el webhook.
//
// «Rápido» acá tiene un significado preciso y es media entrega del canal: el
// 200 sale **después de persistir y encolar**, y nunca después de bajar un
// archivo de Meta ni de llamar al webhook del tenant. Las dos cosas pueden
// tardar segundos —un documento llega hasta 100 MB, el endpoint del cliente
// puede estar caído— y las dos viven en una cola.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  // Se genera antes de todo para que hasta un payload rechazado tenga id: es lo
  // que después ata el sobre, sus N eventos y sus N entregas.
  const requestId = crypto.randomUUID()

  // El techo se comprueba dos veces y no una. El header es lo único que se
  // puede mirar **sin** haber traído el cuerpo, y es lo que evita bufferearlo;
  // pero lo manda el que llama, así que no alcanza por sí solo.
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return rejectOversized(requestId, declared)
  }

  const raw = await request.text()
  const size = new TextEncoder().encode(raw).length
  if (size > MAX_BODY_BYTES) return rejectOversized(requestId, size)

  // Valida que el evento viene de Meta: HMAC-SHA256 del **body crudo** con el
  // App Secret. Tiene que ser el texto tal cual llegó: reserializar el JSON
  // cambia el orden o el espaciado y la firma deja de coincidir.
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
      channel: "whatsapp",
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
      channel: "whatsapp",
      route: ROUTE,
      errorMessage: describeError(error),
    })
    return Response.json({ ok: true })
  }

  // Conteos del sobre, sin nada de contenido. Es lo que distingue «Meta no
  // mandó nada» de «mandó algo y el parser no lo reconoció».
  const envelope = describeWebhookEnvelope(body)

  // El `object` decide de qué producto es el sobre. Se descarta con métrica y
  // no en silencio: un `object` inesperado significa que en el panel de Meta
  // hay una suscripción apuntando acá que no debería, y eso solo se ve si queda
  // escrito.
  const object =
    body && typeof body === "object"
      ? (body as { object?: unknown }).object
      : undefined
  if (object !== WHATSAPP_OBJECT) {
    log({
      entrypoint: "route",
      action: "webhook_receive",
      outcome: "dropped",
      // El catálogo de motivos es cerrado y vive en `logger.ts`; este es el que
      // dice «el sobre no tiene la forma que esta ruta atiende».
      reason: "invalid_request",
      level: "warn",
      requestId,
      channel: "whatsapp",
      route: ROUTE,
      ...envelope,
    })
    return Response.json({ ok: true })
  }

  try {
    const ingested = await ingestWhatsappWebhookPayload(body, requestId)

    const nonEmpty = envelope.changeCount > 0
    log({
      entrypoint: "route",
      action: "webhook_receive",
      // Un sobre con cambios que no produce ninguna entrega no es
      // necesariamente un bug en este canal —los acuses de entrega y el
      // historial no se reenvían—, así que solo se marca como raro cuando el
      // sobre traía cambios y la ingesta no devolvió nada: ahí, o el parser
      // dejó de reconocer el payload, o todo se descartó y hay una línea
      // `inbound_ingest` con el mismo `requestId` que dice por qué.
      ...(ingested.length === 0 && nonEmpty
        ? {
            outcome: "dropped" as const,
            reason: "no_events_in_payload" as const,
            level: "warn" as const,
          }
        : { outcome: "ok" as const }),
      requestId,
      channel: "whatsapp",
      route: ROUTE,
      count: ingested.length,
      ...envelope,
    })

    // El reenvío al webhook del tenant va fuera de la respuesta: Meta solo
    // espera el 200, y el endpoint del cliente puede tardar segundos. Lo que
    // llega hasta acá ya está persistido y con su descarga encolada.
    for (const item of ingested) {
      after(async () => {
        try {
          await item.pushJob()
        } catch (error) {
          // Un throw acá no va a ningún lado: la request ya respondió y nadie
          // escucha. `recordDelivery` hace un insert que puede fallar, así que
          // sin esta línea sería un descarte silencioso más.
          log({
            entrypoint: "after",
            action: "webhook_delivery",
            outcome: "failed",
            reason: "internal_error",
            requestId,
            channel: "whatsapp",
            errorMessage: describeError(error),
          })
        }
      })
    }
  } catch (error) {
    log({
      entrypoint: "route",
      action: "webhook_receive",
      outcome: "failed",
      reason: "internal_error",
      requestId,
      channel: "whatsapp",
      route: ROUTE,
      ...envelope,
      errorMessage: describeError(error),
    })
  }

  return Response.json({ ok: true })
}

// 413 y no 200: reintentar no va a arreglar el tamaño, pero un cuerpo que se
// rechaza sin decirlo es indistinguible de uno que nunca llegó, y este es
// justo el caso que hay que poder ver desde afuera. Meta lo registra como
// entrega fallida, que es exactamente lo que fue.
function rejectOversized(requestId: string, bytes: number) {
  log({
    entrypoint: "route",
    action: "webhook_receive",
    outcome: "dropped",
    reason: "invalid_request",
    level: "warn",
    requestId,
    channel: "whatsapp",
    route: ROUTE,
    status: 413,
    // Un conteo, no contenido: dice cuánto pesaba, nunca qué decía.
    count: bytes,
  })
  return new Response("payload too large", { status: 413 })
}
