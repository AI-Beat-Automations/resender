import { type NextRequest } from "next/server"

import { log } from "@/lib/observability/logger"
import { resolveRequestId } from "@/lib/observability/outbound-log"
import {
  deleteWhatsappTemplateForTenant,
  parseWhatsappTemplateEdit,
  runWhatsappTemplateAdminGates,
  templateAdminFailureResponse,
  updateWhatsappTemplateForTenant,
} from "@/lib/whatsapp-templates/template-admin"

// Editar y borrar **una** [Plantilla], por el id de la fila del espejo.
//
// **Sólo las propias.** Las dos operaciones exigen que la fila tenga
// `created_by_tenant_id` igual al tenant que llama. Es la regla más importante
// de este archivo y no es una precaución genérica: una WABA puede tener números
// de tenants distintos y el catálogo es compartido, así que sin esta
// comprobación un cliente podría editar —o borrar— la plantilla que otro está
// enviando. «No puedo borrar esta» es un mal día; «me borraron las plantillas»
// es un incidente, y encima uno que no se puede deshacer, porque el nombre de
// una plantilla borrada queda quemado 30 días (ADR 0014).
//
// Las importadas por el sync no tienen dueño y son de sólo lectura para todos.
// El 403 lo dice con todas las letras —se administran en WhatsApp Manager— en
// vez de dejar al cliente adivinando por qué una fila que **sí** ve en el `GET`
// no se deja tocar.
//
// **El `pageId` es obligatorio** en las dos, aunque el id ya identifique la
// fila. No es ceremonia: la llamada a Graph necesita el token de un número
// conectado, y el único camino a ese token es la conexión del tenant. De paso
// es lo que hace que una fila de otra WABA no sea siquiera direccionable —el
// id es un uuid, pero la comprobación no depende de eso—. Viaja en el cuerpo
// del `PATCH` y en el query del `DELETE`, que no tiene cuerpo.
//
// La orquestación, incluida la comprobación de propiedad, vive en
// `lib/whatsapp-templates/template-admin.ts`: la consola hace lo mismo desde
// una Server Action (ADR 0012) y esta regla no puede existir dos veces.
export const runtime = "nodejs"

/**
 * `PATCH /api/meta/whatsapp/templates/{id}`
 *
 * Body: `{ pageId, components, category? }`.
 *
 * **Editar una plantilla aprobada se permite**, y la respuesta lo dice:
 * `returnsToReview: true` más un `message` explicando que Meta la revisa de
 * nuevo y que hasta entonces no se puede enviar. Prohibirlo llenaría la WABA de
 * `nombre_v2` contra un tope de 6.000, y la consecuencia de editar es
 * reversible. El aviso **antes** de guardar es requisito de la pantalla; lo que
 * la ruta garantiza es que el dato esté para poder darlo.
 *
 * Errores: los gates, `400 invalid_request | invalid_template_components |
 * invalid_template_category | missing_variable_examples`,
 * `404 page_not_connected | template_not_found`,
 * `403 template_not_owned`, `409 waba_not_resolved | template_missing_meta_id`,
 * y `template_update_failed` con el status que dio Meta.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const action = "template_update"

  const gates = await runWhatsappTemplateAdminGates({
    request,
    action,
    requestId,
  })
  if (!gates.ok) return gates.response
  const { tenantId } = gates.apiKey

  const { id } = await context.params

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

  const edit = parseWhatsappTemplateEdit(body)
  if (!edit.ok) {
    return templateAdminFailureResponse(
      {
        ok: false,
        status: 400,
        error: edit.error,
        message: edit.message,
        reason: "invalid_request",
        outcome: "dropped",
      },
      { action, requestId, tenantId }
    )
  }

  const result = await updateWhatsappTemplateForTenant({
    tenantId,
    pageId: edit.value.pageId,
    templateId: id,
    components: edit.value.components,
    ...(edit.value.category ? { category: edit.value.category } : {}),
  })

  if (!result.ok) {
    return templateAdminFailureResponse(result, {
      action,
      requestId,
      tenantId,
      accountId: edit.value.pageId,
      // Sin `templateName`: cuando el rechazo es «no existe» o «es ajena» no
      // hay fila que nombrar, y en los demás casos el `subjectId` del id ya
      // alcanza para encontrarla.
    })
  }

  log({
    entrypoint: "route",
    action,
    outcome: "ok",
    requestId,
    tenantId,
    channel: "whatsapp",
    accountId: edit.value.pageId,
    subjectId: result.template.id,
    templateName: result.template.name,
    templateLanguage: result.template.language,
    ...(edit.value.category ? { templateCategory: edit.value.category } : {}),
    status: 200,
  })

  // La plantilla va tal cual está en el espejo, con su `status` **sin tocar**.
  // Escribir acá un `PENDING` sería inventar un estado que Meta no dijo y, peor,
  // podría pisar el `APPROVED` que el webhook ya escribió mientras corría este
  // request: la fila quedaría bloqueando envíos legítimos, porque el gate del
  // envío sólo falla abierto cuando la fila no está. El estado lo escribe una
  // sola fuente, que es el webhook.
  return Response.json({
    template: result.template,
    returnsToReview: result.returnsToReview,
    message: result.message,
  })
}

/**
 * `DELETE /api/meta/whatsapp/templates/{id}?pageId=<phone_number_id>`
 *
 * **Siempre por `hsm_id`.** Meta ofrece dos borrados y el otro —por `name`— se
 * lleva todas las versiones de idioma de la plantilla y quema el nombre 30
 * días. Quien quiera borrar cinco idiomas puede pedirlo cinco veces; quien no
 * lo quería no pierde cuatro.
 *
 * Por eso, cuando a la fila le falta el `meta_template_id`, esto contesta
 * `409 template_missing_meta_id` **explicando por qué** y no cae al borrado por
 * nombre: el fallback sería exactamente el desastre que la regla evita,
 * disfrazado de comodidad. La salida es WhatsApp Manager, y el mensaje lo dice.
 *
 * La fila del espejo se borra sólo si Meta aceptó. Al revés, un fallo de Graph
 * nos dejaría sin la fila y por lo tanto sin el hsm id, que es lo único con lo
 * que se puede reintentar.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const action = "template_delete"

  const gates = await runWhatsappTemplateAdminGates({
    request,
    action,
    requestId,
  })
  if (!gates.ok) return gates.response
  const { tenantId } = gates.apiKey

  const { id } = await context.params

  // En el query y no en el cuerpo: un `DELETE` con body es legal pero varios
  // clientes HTTP lo descartan, y este dato no es opcional.
  const pageId = new URL(request.url).searchParams.get("pageId")?.trim()
  if (!pageId) {
    return templateAdminFailureResponse(
      {
        ok: false,
        status: 400,
        error: "invalid_request",
        message:
          "pageId is required: it is the WhatsApp phone number id the template belongs to.",
        reason: "invalid_request",
        outcome: "dropped",
      },
      { action, requestId, tenantId }
    )
  }

  const result = await deleteWhatsappTemplateForTenant({
    tenantId,
    pageId,
    templateId: id,
  })

  if (!result.ok) {
    return templateAdminFailureResponse(result, {
      action,
      requestId,
      tenantId,
      accountId: pageId,
    })
  }

  // El nombre queda en el log porque es el dato que sirve después: durante 30
  // días no se puede volver a crear una plantilla con ese nombre, y «¿por qué
  // Meta me rechaza este nombre?» se contesta buscando este borrado.
  log({
    entrypoint: "route",
    action,
    outcome: "ok",
    requestId,
    tenantId,
    channel: "whatsapp",
    accountId: pageId,
    subjectId: result.id,
    templateName: result.name,
    templateLanguage: result.language,
    status: 200,
  })

  return Response.json({
    deleted: true,
    id: result.id,
    name: result.name,
    language: result.language,
  })
}
