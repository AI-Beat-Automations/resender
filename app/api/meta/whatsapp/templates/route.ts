import { type NextRequest } from "next/server"

import {
  withApiRequestLog,
  type ApiLogCapture,
} from "@/lib/logs/api-request-log"
import { describeError } from "@/lib/observability/logger"
import {
  outboundLogger,
  resolveRequestId,
} from "@/lib/observability/outbound-log"
import { runWhatsappApiGates } from "@/lib/outbound/whatsapp-send-gates"
import { getActiveWhatsappWabaIdForTenant } from "@/lib/pages/page-registry"
import { createTemplate } from "@/lib/whatsapp-templates/template-admin"
import {
  numberNotConnectedResponse,
  readJsonBody,
  serializeTemplate,
  templateMetaRejectedResponse,
} from "@/lib/whatsapp-templates/template-admin-http"
import { validateTemplateDraft } from "@/lib/whatsapp-templates/template-draft"
import {
  isOwnedByParent,
  listWhatsappTemplatesForWaba,
} from "@/lib/whatsapp-templates/template-store"

// Lista el catálogo de [Plantilla]s de la WABA de un número (ADR 0024):
// `GET /api/meta/whatsapp/templates?pageId=<phone_number_id>`.
//
// **Lee la copia local, no Graph.** La trae el job `template_sync` al conectar
// el número; listar no llama a Meta ni consume cuota. La copia no decide qué
// se envía: una plantilla que no aparece acá se puede enviar igual.
//
// El `pageId` es el `phone_number_id`, como en `/send`, y tiene que ser de un
// número activo del tenant de la API key; si no, 404 sin decir si existe en
// otro tenant. La WABA se resuelve de este lado (`connected_pages.waba_id`):
// el cliente nunca la manda.
//
// `own` dice si la plantilla es del [Padre] —la API es suya—: la creó este
// tenant y no uno de sus [Cliente]s. Las que trajo el sync no tienen dueño.
export const runtime = "nodejs"

export const GET = withApiRequestLog(
  {
    channel: "whatsapp",
    eventType: "template_list",
    endpoint: "/api/meta/whatsapp/templates",
  },
  handle
)

async function handle(request: NextRequest, capture: ApiLogCapture) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "template_list",
    channel: "whatsapp",
    subject: "template",
    requestId,
    capture,
  })

  // API key y rate limit, permiso de canal, waitlist y cuenta no restringida.
  // Sin Idempotency-Key: listar no envía nada.
  const gates = await runWhatsappApiGates(request, trace)
  if (!gates.ok) return gates.response
  const { apiKey } = gates

  const pageId = request.nextUrl.searchParams.get("pageId")?.trim()
  if (!pageId) {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "pageId is required" }, { status: 400 })
    )
  }

  const number = await getActiveWhatsappWabaIdForTenant(apiKey.tenantId, pageId)
  if (!number) {
    return trace.drop(
      "page_not_connected",
      Response.json(
        { error: "whatsapp number is not connected" },
        { status: 404 }
      )
    )
  }

  let templates
  try {
    templates = await listWhatsappTemplatesForWaba(number.wabaId)
  } catch (error) {
    trace.failed("internal_error", { errorMessage: describeError(error) })
    throw error
  }

  trace.ok()

  return Response.json({
    templates: templates.map((template) =>
      serializeTemplate(template, isOwnedByParent(template, apiKey.tenantId))
    ),
  })
}

// Crea una [Plantilla] del [Padre] en la WABA del número (issue #194):
// `POST /api/meta/whatsapp/templates` con
// `{ pageId, name, language, category, body: { text, examples }, footer? }`.
//
// Los mismos controles que el listado —el Plan Free pasa— y sin
// Idempotency-Key: un segundo intento con el mismo nombre e idioma lo rechaza
// Meta. La fila queda con dueño (este tenant, sin cliente), el hsm id y el
// estado que devolvió Meta, casi siempre `PENDING`: el webhook de estado avisa
// cuando se aprueba.
export const POST = withApiRequestLog(
  {
    channel: "whatsapp",
    eventType: "template_create",
    endpoint: "/api/meta/whatsapp/templates",
  },
  handleCreate
)

async function handleCreate(request: NextRequest, capture: ApiLogCapture) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "template_create",
    channel: "whatsapp",
    subject: "template",
    requestId,
    capture,
  })

  const gates = await runWhatsappApiGates(request, trace)
  if (!gates.ok) return gates.response
  const { apiKey } = gates

  const body = await readJsonBody(request)
  if (!body.ok) return trace.drop("invalid_request", body.response)

  const pageId =
    typeof body.value.pageId === "string" ? body.value.pageId.trim() : ""
  if (!pageId) {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "pageId is required" }, { status: 400 })
    )
  }

  const draft = validateTemplateDraft(body.value)
  if (!draft.ok) {
    return trace.drop(
      "invalid_request",
      Response.json({ code: draft.code, error: draft.error }, { status: 400 }),
      { errorCode: draft.code }
    )
  }

  let result
  try {
    result = await createTemplate({
      actor: { tenantId: apiKey.tenantId, clientAccountId: null },
      phoneNumberId: pageId,
      draft: draft.value,
    })
  } catch (error) {
    trace.failed("internal_error", { errorMessage: describeError(error) })
    throw error
  }

  if (result.kind === "number_not_connected") {
    return trace.drop("page_not_connected", numberNotConnectedResponse())
  }
  trace.setAccount(result.page)
  if (result.kind === "meta_rejected") {
    return templateMetaRejectedResponse(trace, result.failure, draft.value.name)
  }

  trace.ok({
    subjectId: result.template.id,
    templateName: result.template.name,
  })

  return Response.json(
    { template: serializeTemplate(result.template, true) },
    { status: 201 }
  )
}
