import { type NextRequest } from "next/server"

import { log } from "@/lib/observability/logger"
import { resolveRequestId } from "@/lib/observability/outbound-log"
import {
  createWhatsappTemplateForTenant,
  listWhatsappTemplatesForTenant,
  parseWhatsappTemplateDraft,
  runWhatsappTemplateAdminGates,
  templateAdminFailureResponse,
} from "@/lib/whatsapp-templates/template-admin"

// El catálogo de [Plantilla]s de un número: listarlo y crear una nueva.
//
// **Se direcciona por `pageId` —el `phone_number_id`— y nunca por WABA.** Toda
// la API pública es orientada al número, y la WABA se resuelve del lado del
// servidor leyendo `connected_pages.waba_id`: el cliente no tiene por qué
// conocer un identificador que además comparte con otros tenants (ADR 0014).
//
// **La orquestación no está acá abajo.** Vive en
// `lib/whatsapp-templates/template-admin.ts` porque la pantalla de la consola
// hace exactamente lo mismo desde Server Actions que llaman a `lib/*` directo
// (ADR 0012), y una regla de propiedad duplicada entre la ruta y la consola es
// una regla que en algún momento va a decir dos cosas distintas. Este archivo
// es transporte: qué es un 200, qué es un 400, y qué se escribe en el log.
//
// Los gates son los del envío **menos los de mensajería**. La lista de lo que
// falta —`Idempotency-Key`, cuota, conversación, ventana de atención— y el
// motivo de cada ausencia están en `runWhatsappTemplateAdminGates`, y no en un
// comentario acá, para que quien agregue una quinta operación los lea antes de
// copiar la secuencia.
export const runtime = "nodejs"

/**
 * `GET /api/meta/whatsapp/templates?pageId=<phone_number_id>`
 *
 * **Lee del espejo, no de Graph**, y es el único lugar de la entrega donde el
 * espejo es la fuente. Es aceptable porque listar no envía nada: lo peor que
 * produce un espejo con retraso es una fila que falta en una pantalla, mientras
 * que consultarle el catálogo a Meta en cada pintada gastaría rate limit del
 * cliente en cada recarga.
 *
 * Errores: `401 unauthorized`, `403 channel_not_enabled | waitlisted |
 * no_active_subscription`, `400 invalid_request`, `404 page_not_connected`,
 * `409 waba_not_resolved`.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const action = "template_list"

  const gates = await runWhatsappTemplateAdminGates({
    request,
    action,
    requestId,
  })
  if (!gates.ok) return gates.response
  const { tenantId } = gates.apiKey

  // `new URL(request.url)` y no `request.nextUrl`: lo único que hace falta es
  // el query, y leerlo del estándar deja el handler probable con una `Request`
  // común, sin arrastrar el envoltorio de Next a un test que no lo necesita.
  const pageId = new URL(request.url).searchParams.get("pageId")?.trim()
  if (!pageId) {
    return templateAdminFailureResponse(
      {
        ok: false,
        status: 400,
        error: "invalid_request",
        message:
          "pageId is required: it is the WhatsApp phone number id whose template catalogue you want.",
        reason: "invalid_request",
        outcome: "dropped",
      },
      { action, requestId, tenantId }
    )
  }

  const result = await listWhatsappTemplatesForTenant({ tenantId, pageId })
  if (!result.ok) {
    return templateAdminFailureResponse(result, {
      action,
      requestId,
      tenantId,
      accountId: pageId,
    })
  }

  log({
    entrypoint: "route",
    action,
    outcome: "ok",
    requestId,
    tenantId,
    channel: "whatsapp",
    accountId: pageId,
    count: result.templates.length,
    status: 200,
  })

  // Sin `wabaId` en el sobre: es el identificador que la ruta resuelve por
  // dentro justamente para no pedírselo al cliente, y devolverlo lo invitaría a
  // guardárselo y a mandarlo la próxima vez.
  return Response.json({ templates: result.templates })
}

/**
 * `POST /api/meta/whatsapp/templates`
 *
 * Body: `{ pageId, name, language, category, components }`. Crea la plantilla
 * en la WABA del número y espeja la fila **sólo si Meta aceptó**.
 *
 * Deja un efecto permanente: Meta la revisa automáticamente, cuenta contra el
 * tope de 6.000 de la WABA y su nombre queda tomado. Por eso el gate de
 * suscripción activa, que en una operación de lectura sería discutible.
 *
 * Errores: los del `GET`, más `400 invalid_template_name |
 * invalid_template_language | invalid_template_category |
 * invalid_template_components | missing_variable_examples` y el
 * `template_create_failed` que traduce el rechazo de Meta con su propio status.
 */
export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const action = "template_create"

  const gates = await runWhatsappTemplateAdminGates({
    request,
    action,
    requestId,
  })
  if (!gates.ok) return gates.response
  const { tenantId } = gates.apiKey

  // El JSON se lee acá y no en los gates: a diferencia del envío, donde el
  // cuerpo se parsea después del replay idempotente para que la respuesta de
  // una cuenta restringida le gane a la de un cuerpo mal formado, acá no hay
  // replay ni cuota que puedan ganarle.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return templateAdminFailureResponse(
      {
        ok: false,
        status: 400,
        error: "invalid_request",
        message: "The request body must be valid JSON.",
        reason: "invalid_request",
        outcome: "dropped",
      },
      { action, requestId, tenantId }
    )
  }

  const draft = parseWhatsappTemplateDraft(body)
  if (!draft.ok) {
    return templateAdminFailureResponse(
      {
        ok: false,
        status: 400,
        error: draft.error,
        message: draft.message,
        reason: "invalid_request",
        outcome: "dropped",
      },
      { action, requestId, tenantId }
    )
  }

  const { pageId, name, language, category, components } = draft.value

  const result = await createWhatsappTemplateForTenant({
    tenantId,
    pageId,
    name,
    language,
    category,
    components,
  })

  if (!result.ok) {
    return templateAdminFailureResponse(result, {
      action,
      requestId,
      tenantId,
      accountId: pageId,
      // El nombre sí, los `components` no: son datos del cliente final y valen
      // lo mismo que el texto de un mensaje, que este producto no escribe en
      // logs.
      templateName: name,
      templateLanguage: language,
    })
  }

  log({
    entrypoint: "route",
    action,
    outcome: "ok",
    requestId,
    tenantId,
    channel: "whatsapp",
    accountId: pageId,
    subjectId: result.template.id,
    templateName: name,
    templateLanguage: language,
    templateStatus: result.template.rawStatus ?? result.template.status,
    templateCategory: category,
    status: 201,
  })

  // `201` con la fila espejada. `mirrored: false` es el caso raro en el que
  // Meta creó la plantilla y nuestra escritura falló: la plantilla existe y se
  // puede enviar, así que devolver un error ahí sería mentir en la dirección
  // más cara —el cliente reintentaría contra un nombre que ya quemó—.
  return Response.json(
    { template: result.template, mirrored: result.mirrored },
    { status: 201 }
  )
}
