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
import {
  deleteTemplate,
  editTemplate,
} from "@/lib/whatsapp-templates/template-admin"
import {
  missingMetaTemplateIdResponse,
  numberNotConnectedResponse,
  readJsonBody,
  serializeTemplate,
  templateMetaRejectedResponse,
  templateNotFoundResponse,
  templateNotOwnedResponse,
} from "@/lib/whatsapp-templates/template-admin-http"
import { validateTemplateContent } from "@/lib/whatsapp-templates/template-draft"

// Edita y borra una [Plantilla] propia del [Padre] (issue #194). El `{id}` es
// nuestro uuid —el `id` del listado—, no el hsm id de Meta.
//
// - `PATCH /api/meta/whatsapp/templates/{id}` con `{ pageId, body, footer? }`:
//   reemplaza el contenido en Meta. Editar una `APPROVED` se permite y la
//   manda de nuevo a revisión: `reviewRequired: true`.
// - `DELETE /api/meta/whatsapp/templates/{id}?pageId=`: borra **solo ese
//   idioma**, siempre por hsm id.
//
// Solo las propias: las importadas por el sync, las de un [Cliente] y las de
// otro tenant de la WABA dan 403 `template_not_owned`. Las dos informan
// `usedByOtherNumbers`: cuántos números de la WABA fuera del tenant ya la
// enviaron. Informa, no bloquea.
//
// Los controles son los del listado, y sin Idempotency-Key.
export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

export const PATCH = withApiRequestLog<Context>(
  {
    channel: "whatsapp",
    eventType: "template_edit",
    endpoint: "/api/meta/whatsapp/templates/{id}",
  },
  handleEdit
)

export const DELETE = withApiRequestLog<Context>(
  {
    channel: "whatsapp",
    eventType: "template_delete",
    endpoint: "/api/meta/whatsapp/templates/{id}",
  },
  handleDelete
)

async function handleEdit(
  request: NextRequest,
  capture: ApiLogCapture,
  context: Context
) {
  const { id } = await context.params
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "template_edit",
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

  const content = validateTemplateContent(body.value)
  if (!content.ok) {
    return trace.drop(
      "invalid_request",
      Response.json(
        { code: content.code, error: content.error },
        { status: 400 }
      ),
      { errorCode: content.code }
    )
  }

  let result
  try {
    result = await editTemplate({
      actor: { tenantId: apiKey.tenantId, clientAccountId: null },
      phoneNumberId: pageId,
      templateId: id,
      content: content.value,
    })
  } catch (error) {
    trace.failed("internal_error", { errorMessage: describeError(error) })
    throw error
  }

  switch (result.kind) {
    case "number_not_connected":
      return trace.drop("page_not_connected", numberNotConnectedResponse())
    case "not_found":
      return trace.drop("template_not_found", templateNotFoundResponse())
    case "not_owned":
      return trace.drop("template_not_owned", templateNotOwnedResponse(), {
        subjectId: id,
      })
    case "missing_meta_template_id":
      return trace.drop(
        "template_missing_meta_id",
        missingMetaTemplateIdResponse(),
        { subjectId: id }
      )
    case "meta_rejected":
      trace.setAccount(result.page)
      return templateMetaRejectedResponse(trace, result.failure, id)
  }

  trace.setAccount(result.page)
  trace.ok({
    subjectId: result.template.id,
    templateName: result.template.name,
  })

  return Response.json({
    template: serializeTemplate(result.template, true),
    reviewRequired: result.reviewRequired,
    usedByOtherNumbers: result.usedByOtherNumbers,
  })
}

async function handleDelete(
  request: NextRequest,
  capture: ApiLogCapture,
  context: Context
) {
  const { id } = await context.params
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  const trace = outboundLogger({
    action: "template_delete",
    channel: "whatsapp",
    subject: "template",
    requestId,
    capture,
  })

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

  let result
  try {
    result = await deleteTemplate({
      actor: { tenantId: apiKey.tenantId, clientAccountId: null },
      phoneNumberId: pageId,
      templateId: id,
    })
  } catch (error) {
    trace.failed("internal_error", { errorMessage: describeError(error) })
    throw error
  }

  switch (result.kind) {
    case "number_not_connected":
      return trace.drop("page_not_connected", numberNotConnectedResponse())
    case "not_found":
      return trace.drop("template_not_found", templateNotFoundResponse())
    case "not_owned":
      return trace.drop("template_not_owned", templateNotOwnedResponse(), {
        subjectId: id,
      })
    case "missing_meta_template_id":
      return trace.drop(
        "template_missing_meta_id",
        missingMetaTemplateIdResponse(),
        { subjectId: id }
      )
    case "meta_rejected":
      trace.setAccount(result.page)
      return templateMetaRejectedResponse(trace, result.failure, id)
  }

  trace.setAccount(result.page)
  trace.ok({
    subjectId: result.template.id,
    templateName: result.template.name,
  })

  return Response.json({
    deleted: true,
    template: serializeTemplate(result.template, true),
    usedByOtherNumbers: result.usedByOtherNumbers,
  })
}
