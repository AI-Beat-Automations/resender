import { createHmac, randomBytes, timingSafeEqual } from "crypto"

import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption"

// Firma del push al webhook del tenant.
//
// Hasta ahora el reenvío salía con `Content-Type` y nada más: quien recibía en
// n8n no tenía forma de distinguir un evento nuestro de un POST cualquiera
// contra una URL que, por diseño, es pública. La columna
// `webhook_signing_secret_encrypted` existía desde la migración 0010 y no la
// escribía nadie.
//
// El esquema es el de Stripe y el de Meta, y es deliberado: es el que la gente
// que integra webhooks ya sabe verificar, y hay librerías para copiar.

// Prefijo legible + secreto aleatorio, igual que las API keys del producto
// (`pk_live_...`). El prefijo hace obvio qué es cuando aparece pegado en un
// campo de configuración de n8n.
const SECRET_PREFIX = "whsec_"
const SECRET_BYTES = 32

// La versión va en la cabecera (`v1=...`) y no en el secreto: si algún día
// cambia el algoritmo o lo que se firma, un receptor puede aceptar las dos
// mientras migra, en vez de tener que cortar de un día para el otro.
const SIGNATURE_VERSION = "v1"

// Ventana de tolerancia sugerida al receptor para el timestamp. No la aplicamos
// nosotros —somos el emisor—, pero va documentada acá porque es la mitad del
// esquema que evita el replay: sin comparar el timestamp, una firma capturada
// vale para siempre.
export const SIGNATURE_TOLERANCE_SECONDS = 300

export function generateWebhookSigningSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`
}

export function encryptWebhookSigningSecret(secret: string): string {
  return encryptSecret(secret)
}

// Qué se firma: `eventId.timestamp.body`, no solo el body.
//
// El `eventId` ata la firma a **este** evento: sin él, una firma válida de un
// mensaje sirve para reenviar otro cuerpo idéntico como si fuera nuevo. El
// timestamp ata la firma a **este momento**, que es lo que le permite al
// receptor descartar un replay viejo. Firmar solo el body dejaría las dos
// puertas abiertas.
export function signaturePayload(input: {
  eventId: string
  timestamp: number
  body: string
}): string {
  return `${input.eventId}.${input.timestamp}.${input.body}`
}

export function signWebhookBody(input: {
  secret: string
  eventId: string
  timestamp: number
  body: string
}): string {
  const digest = createHmac("sha256", input.secret)
    .update(signaturePayload(input))
    .digest("hex")
  return `${SIGNATURE_VERSION}=${digest}`
}

// Cabeceras del push. Se arman juntas y en un solo lugar porque las tres son
// una sola cosa: una firma sin su `eventId` y su timestamp no se puede
// verificar, y mandarlas por separado invita a que alguna se olvide.
export function signedWebhookHeaders(input: {
  encryptedSecret: string
  eventId: string
  body: string
  now?: Date
}): Record<string, string> {
  const timestamp = Math.floor((input.now ?? new Date()).getTime() / 1000)
  return {
    "resender-event-id": input.eventId,
    "resender-timestamp": String(timestamp),
    "resender-signature": signWebhookBody({
      secret: decryptSecret(input.encryptedSecret),
      eventId: input.eventId,
      timestamp,
      body: input.body,
    }),
  }
}

// Existe para el test y para la documentación pública: es la contraparte exacta
// de lo que hacemos al firmar, y tenerla acá evita que el ejemplo que se le da
// al cliente se desincronice del emisor.
//
// La comparación es en tiempo constante. Un `===` sobre un hex filtra, por lo
// que tarda en fallar, cuántos caracteres del principio acertó quien prueba.
export function verifyWebhookSignature(input: {
  secret: string
  eventId: string
  timestamp: number
  body: string
  signature: string
}): boolean {
  const expected = signWebhookBody(input)
  const a = Buffer.from(expected)
  const b = Buffer.from(input.signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
