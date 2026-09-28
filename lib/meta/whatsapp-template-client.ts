import { GRAPH_FACEBOOK_BASE, GRAPH_FACEBOOK_HOST } from "@/lib/meta/graph-version"
import {
  bearer,
  graphRequest,
  WHATSAPP_TOKEN_EXPIRED_REASON,
  WhatsappApiError,
} from "@/lib/meta/whatsapp-client"
import { log, type LogAction } from "@/lib/observability/logger"
import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
  extractMetaErrorSubcode,
} from "@/lib/outbound/meta-send"

// Cliente de Graph para el catálogo de [Plantilla]s de una WABA (ADR 0024).
//
// Vive aparte de `whatsapp-client.ts`, que ya es el onboarding, la media y el
// envío. El transporte sí es el de allá (`graphRequest`): plazo, log del fallo
// de red y `json()` defensivo son los mismos.
//
// Lee el catálogo (job `template_sync`) y administra las plantillas propias:
// crear, editar y borrar (issue #194). Las tres de administración no lanzan
// ante un rechazo de Meta: devuelven el sobre ya traducido, porque la ruta
// tiene que contestarlo tal cual y no es un fallo nuestro.

// Lo que se le pide a Meta por plantilla. `components` trae el cuerpo; el resto
// es la identidad (`name` + `language`), el hsm id y el estado.
const TEMPLATE_FIELDS = "id,name,language,status,category,components"

// Página de 100: el tope de Meta es 6.000 plantillas por WABA, así que son a lo
// sumo 60 páginas. `MAX_PAGES` es la red por si `paging.next` no se termina
// nunca: un cursor que vuelve sobre sí mismo no puede colgar un job.
const PAGE_SIZE = 100
const MAX_PAGES = 100

export type WhatsappTemplateCategory = "utility" | "marketing" | "authentication"

export type WhatsappTemplateListing = {
  metaTemplateId: string | null
  name: string
  language: string
  // Tal cual lo manda Meta (`APPROVED`, `PENDING`, …). Se normaliza al leer
  // de la base, no acá: un estado nuevo se guarda igual.
  status: string
  category: WhatsappTemplateCategory | null
  // El texto del componente BODY con sus `{{n}}`, o null si no vino.
  body: string | null
}

/**
 * Todo el catálogo de la WABA, siguiendo `paging.next` hasta el final.
 *
 * Lanza `WhatsappApiError` si una página falla: un catálogo a medias no se
 * guarda como si fuera el entero, y el job lo reintenta.
 */
export async function listWhatsappTemplates(
  accessToken: string,
  wabaId: string
): Promise<WhatsappTemplateListing[]> {
  const first = new URL(
    `${GRAPH_FACEBOOK_BASE}/${encodeURIComponent(wabaId)}/message_templates`
  )
  first.searchParams.set("fields", TEMPLATE_FIELDS)
  first.searchParams.set("limit", String(PAGE_SIZE))

  const templates: WhatsappTemplateListing[] = []
  let next: string | null = first.toString()

  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const { ok, status, data } = await graphRequest(
      { step: "template_list", action: "template_sync", accountId: wabaId },
      next,
      { headers: bearer(accessToken) }
    )

    if (!ok || !Array.isArray(data.data)) {
      // Sin el body, igual que `logMetaFailure`: se extraen código, subcódigo y
      // mensaje, que es lo único que sirve para diagnosticar.
      log({
        entrypoint: "queue",
        action: "template_sync",
        outcome: "failed",
        reason: "template_list_failed",
        channel: "whatsapp",
        accountId: wabaId,
        status,
        errorCode: extractMetaErrorCode(data) ?? undefined,
        errorSubcode: extractMetaErrorSubcode(data) ?? undefined,
        errorMessage: extractMetaErrorMessage(data) ?? undefined,
      })
      throw new WhatsappApiError(
        "template list failed",
        "template_list",
        "template_list_failed",
        extractMetaErrorCode(data)
      )
    }

    for (const item of data.data) {
      const template = parseTemplate(item)
      if (template) templates.push(template)
    }

    next = readNextPage(data.paging)
  }

  return templates
}

// ---------------------------------------------------------------------------
// Administración: crear, editar y borrar (issue #194)
// ---------------------------------------------------------------------------

export type WhatsappTemplateAdminFailure = {
  ok: false
  // El HTTP de Meta, o 502 si la llamada ni siquiera llegó.
  status: number
  // Identificador estable para la API pública, o null si no hay traducción.
  code: string | null
  error: string
  metaErrorCode: number | null
  metaErrorSubcode: number | null
}

export type WhatsappTemplateAdminResult<T> =
  ({ ok: true } & T) | WhatsappTemplateAdminFailure

type AdminAction = Extract<
  LogAction,
  "template_create" | "template_edit" | "template_delete"
>

/**
 * `POST /{waba_id}/message_templates`. Meta contesta `{ id, status, category }`:
 * el `id` es el hsm id, lo único con que después se borra un solo idioma.
 */
export async function createWhatsappTemplate(
  accessToken: string,
  wabaId: string,
  template: {
    name: string
    language: string
    category: string
    components: Record<string, unknown>[]
  }
): Promise<
  WhatsappTemplateAdminResult<{ metaTemplateId: string | null; status: string }>
> {
  const response = await adminRequest(
    "template_create",
    wabaId,
    `${GRAPH_FACEBOOK_BASE}/${encodeURIComponent(wabaId)}/message_templates`,
    {
      method: "POST",
      headers: { ...bearer(accessToken), "content-type": "application/json" },
      body: JSON.stringify({
        name: template.name,
        language: template.language,
        // Graph la documenta en mayúsculas.
        category: template.category.toUpperCase(),
        components: template.components,
      }),
    }
  )
  if (!response.ok) return response

  return {
    ok: true,
    metaTemplateId: readString(response.data.id),
    // Meta la manda casi siempre `PENDING`; si no la manda, es lo que es.
    status: readString(response.data.status) ?? "PENDING",
  }
}

/**
 * `POST /{template_id}` con los `components` nuevos, que **reemplazan** a los
 * anteriores. Meta contesta `{ success: true }`; editar una aprobada la manda
 * de nuevo a revisión.
 */
export async function editWhatsappTemplate(
  accessToken: string,
  input: {
    wabaId: string
    metaTemplateId: string
    components: Record<string, unknown>[]
  }
): Promise<WhatsappTemplateAdminResult<object>> {
  const response = await adminRequest(
    "template_edit",
    input.wabaId,
    `${GRAPH_FACEBOOK_BASE}/${encodeURIComponent(input.metaTemplateId)}`,
    {
      method: "POST",
      headers: { ...bearer(accessToken), "content-type": "application/json" },
      body: JSON.stringify({ components: input.components }),
    }
  )
  return response.ok ? { ok: true } : response
}

/**
 * `DELETE /{waba_id}/message_templates?hsm_id=…&name=…`: borra **solo** ese
 * idioma. Los dos parámetros son obligatorios y el `hsm_id` no es opcional
 * acá: sin él, Meta borra la plantilla en todos los idiomas y bloquea el
 * nombre 30 días. Por eso la firma lo exige y no hay variante por nombre.
 */
export async function deleteWhatsappTemplate(
  accessToken: string,
  input: { wabaId: string; metaTemplateId: string; name: string }
): Promise<WhatsappTemplateAdminResult<object>> {
  const url = new URL(
    `${GRAPH_FACEBOOK_BASE}/${encodeURIComponent(input.wabaId)}/message_templates`
  )
  url.searchParams.set("hsm_id", input.metaTemplateId)
  url.searchParams.set("name", input.name)

  const response = await adminRequest("template_delete", input.wabaId, url, {
    method: "DELETE",
    headers: bearer(accessToken),
  })
  return response.ok ? { ok: true } : response
}

/**
 * Traducción de los rechazos de administración de plantillas. Solo los
 * códigos que Meta documenta (`/support/error-codes`): el nombre duplicado,
 * el nombre bloqueado por un borrado reciente y los límites por hora y de
 * ediciones no tienen subcódigo publicado, así que **no se traducen**: el
 * mensaje de Meta viaja tal cual y el subcódigo queda en el log.
 */
export function explainWhatsappTemplateAdminError(
  data: unknown
): { code: string | null; message: string } | null {
  const code = extractMetaErrorCode(data)
  const subcode = extractMetaErrorSubcode(data)

  if (code === 190) {
    return { code: null, message: WHATSAPP_TOKEN_EXPIRED_REASON }
  }

  switch (subcode) {
    case 2388019:
      return {
        code: "template_limit_reached",
        message:
          "This WhatsApp Business account reached its maximum number of templates (250 for unverified businesses, up to 6,000 for verified ones). Delete templates you don't use or verify the business in Meta.",
      }
    case 2388039:
      return {
        code: "template_under_review",
        message:
          "WhatsApp is still reviewing this template, so it can't be edited yet. Try again when the review finishes.",
      }
    case 2388040:
      return {
        code: "template_invalid_format",
        message: "A field of the template is longer than WhatsApp allows.",
      }
    case 2388072:
      return {
        code: "template_invalid_format",
        message: "WhatsApp rejected the formatting of the template body.",
      }
    case 2388073:
      return {
        code: "template_invalid_format",
        message: "WhatsApp rejected the formatting of the template footer.",
      }
    case 2388293:
      return {
        code: "template_invalid_format",
        message:
          "The template has too many variables for its length: add more fixed text around them.",
      }
    case 2388299:
      return {
        code: "template_invalid_format",
        message:
          "Variables can't be at the start or the end of the template body.",
      }
    default:
      return null
  }
}

async function adminRequest(
  action: AdminAction,
  wabaId: string,
  input: URL | string,
  init: RequestInit
): Promise<
  { ok: true; data: Record<string, unknown> } | WhatsappTemplateAdminFailure
> {
  let response
  try {
    response = await graphRequest(
      { step: "template_manage", action, accountId: wabaId },
      input,
      init
    )
  } catch (error) {
    // `graphRequest` ya logueó el fallo de red.
    if (!(error instanceof WhatsappApiError)) throw error
    return {
      ok: false,
      status: 502,
      code: null,
      error: "We couldn't reach WhatsApp. Try again in a moment.",
      metaErrorCode: null,
      metaErrorSubcode: null,
    }
  }

  const { ok, status, data } = response
  if (ok) return { ok: true, data }

  const metaErrorCode = extractMetaErrorCode(data)
  const metaErrorSubcode = extractMetaErrorSubcode(data)
  // Sin el body, como el listado: código, subcódigo y mensaje. Es donde se
  // aprenden los subcódigos que Meta no documenta.
  log({
    entrypoint: "route",
    action,
    outcome: "failed",
    reason: "meta_rejected",
    channel: "whatsapp",
    accountId: wabaId,
    status,
    errorCode: metaErrorCode ?? undefined,
    errorSubcode: metaErrorSubcode ?? undefined,
    errorMessage: extractMetaErrorMessage(data) ?? undefined,
  })

  const explained = explainWhatsappTemplateAdminError(data)
  return {
    ok: false,
    // Un 5xx de Meta es un fallo de la dependencia, no del pedido.
    status: status >= 500 ? 502 : status,
    code: explained?.code ?? null,
    error:
      explained?.message ??
      readMetaUserMessage(data) ??
      extractMetaErrorMessage(data) ??
      "WhatsApp rejected the request.",
    metaErrorCode,
    metaErrorSubcode,
  }
}

// `error_user_msg` es el texto que Meta escribe para una persona («Ya existe
// contenido en English (US)…»), más útil que `message`, que es genérico.
function readMetaUserMessage(data: unknown): string | null {
  const error = asRecord(asRecord(data)?.error)
  return readString(error?.error_user_msg)
}

/** El texto del componente `BODY`, con sus `{{n}}` sin reemplazar. */
export function extractWhatsappTemplateBody(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  for (const component of components) {
    const record = asRecord(component)
    if (readString(record?.type)?.toUpperCase() !== "BODY") continue
    return readString(record?.text)
  }
  return null
}

function parseTemplate(value: unknown): WhatsappTemplateListing | null {
  const record = asRecord(value)
  const name = readString(record?.name)
  const language = readString(record?.language)
  const status = readString(record?.status)
  // Sin identidad o sin estado no hay fila que escribir: `status` es not null.
  if (!record || !name || !language || !status) return null

  return {
    metaTemplateId: readString(record.id),
    name,
    language,
    status,
    category: parseCategory(record.category),
    body: extractWhatsappTemplateBody(record.components),
  }
}

// Meta la manda en mayúsculas (`UTILITY`); la columna tiene check en
// minúsculas. Una categoría que no es de las tres queda null en vez de romper
// el upsert de todo el catálogo.
function parseCategory(value: unknown): WhatsappTemplateCategory | null {
  const category = readString(value)?.toLowerCase()
  return category === "utility" ||
    category === "marketing" ||
    category === "authentication"
    ? category
    : null
}

// `paging.next` es una URL absoluta que arma Meta. Solo se sigue si apunta al
// Graph: el Bearer del cliente viaja en esa petición y no puede salir hacia
// otro host.
function readNextPage(paging: unknown): string | null {
  const next = readString(asRecord(paging)?.next)
  if (!next) return null
  try {
    return new URL(next).origin === GRAPH_FACEBOOK_HOST ? next : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
