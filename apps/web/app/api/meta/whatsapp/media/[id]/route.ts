import { getSession } from "@/lib/auth/session"
import { authenticateApiKey } from "@/lib/api-keys/api-keys"
import {
  getMediaBucket,
  lookupMediaForTenant,
} from "@/lib/messages/media-access"
import { log } from "@/lib/observability/logger"
import { getBearerToken } from "@/lib/outbound/send-request"

// Descarga de un medio entrante de WhatsApp. **Una ruta, dos autenticaciones**:
// la API key del tenant (es la URL que viaja en el push a su webhook) o la
// cookie de sesión (es la que abre el Inbox). Son los dos consumidores reales y
// separar la ruta en dos habría duplicado el ownership, que es la parte que no
// puede divergir.
//
// No se usan URLs prefirmadas. El binding de R2 no firma —requeriría habilitar
// la API S3, dos secretos nuevos y una librería de firma en el bundle, que ya
// mide 5,82 de 8 MB— y sobre todo una URL prefirmada filtrada es acceso anónimo
// al archivo, mientras que esta pide credencial en cada request.
export const runtime = "nodejs"

async function resolveTenantId(request: Request): Promise<string | null> {
  // La API key va primero: el push al webhook del tenant la manda por
  // `Authorization`, y ese es el camino caliente. La sesión es el del Inbox.
  const bearer = getBearerToken(request.headers.get("authorization"))
  if (bearer) {
    const apiKey = await authenticateApiKey(bearer)
    if (apiKey) return apiKey.tenantId
  }

  const session = await getSession()
  return session?.user?.id ?? null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const requestId = crypto.randomUUID()

  const tenantId = await resolveTenantId(request)
  if (!tenantId) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const media = await lookupMediaForTenant({ tenantId, messageId: id })

  if (!media.ok && media.reason === "not_found") {
    // 404 y no 403 también cuando el mensaje existe pero es de otro tenant: un
    // 403 confirmaría que ese id existe, que es exactamente lo que no hay que
    // decirle a quien está probando ids ajenos.
    return Response.json({ error: "not_found" }, { status: 404 })
  }

  if (!media.ok) {
    // 409 con el estado adentro: el cliente necesita distinguir «todavía se
    // está bajando» de «se venció a los 180 días» de «WhatsApp nunca lo
    // ofreció», porque solo en el primer caso tiene sentido reintentar.
    return Response.json(
      { error: "attachment_not_available", status: media.status },
      { status: 409 }
    )
  }

  const range = request.headers.get("range")
  const object = await getMediaBucket().get(
    media.key,
    range ? { range } : undefined
  )

  if (!object) {
    // La fila dice `available` y el objeto no está: o la lifecycle rule se
    // adelantó o alguien borró el bucket a mano. Se registra porque es la señal
    // de que el estado derivado y R2 se separaron.
    log({
      entrypoint: "route",
      action: "media_download",
      outcome: "failed",
      reason: "media_object_missing",
      channel: "whatsapp",
      tenantId,
      requestId,
      subjectId: id,
    })
    return Response.json({ error: "not_found" }, { status: 404 })
  }

  // Se hace streaming desde R2 al cliente: un documento de WhatsApp llega hasta
  // 100 MB y cargarlo entero en memoria es la forma de tumbar el isolate.
  //
  // `Accept-Ranges` no es un extra: sin él, un `<audio>` de nota de voz no se
  // puede adelantar en el navegador.
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers: {
      "content-type": object.httpMetadata?.contentType ?? media.mimeType,
      "accept-ranges": "bytes",
      // Privado: es contenido de un tenant y no puede quedar en la caché de
      // ningún intermediario.
      "cache-control": "private, max-age=0, no-store",
    },
  })
}
