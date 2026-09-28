import type { WhatsappTemplateAdminFailure } from "@/lib/meta/whatsapp-template-client"
import type { outboundLogger } from "@/lib/observability/outbound-log"

import type { WhatsappTemplateRecord } from "./template-store"

// Las respuestas que comparten las rutas de administración de [Plantilla]s
// (`POST /templates`, `PATCH` y `DELETE /templates/{id}`, issue #194). Viven
// juntas para que los tres casos de error se contesten igual en las tres.

type OutboundTrace = ReturnType<typeof outboundLogger>

/** La forma pública de una plantilla, la misma del listado. */
export function serializeTemplate(
  template: WhatsappTemplateRecord,
  own: boolean
) {
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    body: template.body,
    own,
  }
}

export async function readJsonBody(
  request: Request
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  try {
    const value: unknown = await request.json()
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { ok: true, value: value as Record<string, unknown> }
    }
  } catch {
    // Cae al 400 de abajo.
  }
  return {
    ok: false,
    response: Response.json({ error: "invalid json" }, { status: 400 }),
  }
}

// El `pageId` no es un número activo del tenant: 404 sin decir si existe en
// otro, como el listado.
export function numberNotConnectedResponse() {
  return Response.json(
    { error: "whatsapp number is not connected" },
    { status: 404 }
  )
}

// No existe, o es de una WABA que el actor no ve: la misma respuesta, para no
// confirmar ids ajenos.
export function templateNotFoundResponse() {
  return Response.json(
    { code: "template_not_found", error: "template not found" },
    { status: 404 }
  )
}

export function templateNotOwnedResponse() {
  return Response.json(
    {
      code: "template_not_owned",
      error:
        "This template wasn't created from this Resender account, so it can't be changed here: edit it in WhatsApp Manager.",
    },
    { status: 403 }
  )
}

export function missingMetaTemplateIdResponse() {
  return Response.json(
    {
      code: "template_missing_meta_id",
      error:
        "We don't have this template's WhatsApp id yet. Deleting it by name would delete it in every language, so it wasn't changed. Try again in a few minutes, or manage it in WhatsApp Manager.",
    },
    { status: 409 }
  )
}

// El rechazo de Meta, ya traducido donde el código está documentado; si no,
// con el mensaje de Meta tal cual.
export function templateMetaRejectedResponse(
  trace: OutboundTrace,
  failure: WhatsappTemplateAdminFailure,
  templateName: string
) {
  const status = failure.status >= 400 ? failure.status : 502
  trace.failed("meta_rejected", {
    status,
    templateName,
    ...(failure.metaErrorCode !== null
      ? { errorCode: failure.metaErrorCode }
      : {}),
    ...(failure.metaErrorSubcode !== null
      ? { errorSubcode: failure.metaErrorSubcode }
      : {}),
    errorMessage: failure.error,
  })
  return Response.json(
    {
      ...(failure.code ? { code: failure.code } : {}),
      error: failure.error,
      meta: {
        code: failure.metaErrorCode,
        subcode: failure.metaErrorSubcode,
      },
    },
    { status }
  )
}
