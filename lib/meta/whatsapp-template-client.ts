import { GRAPH_FACEBOOK_BASE, GRAPH_FACEBOOK_HOST } from "@/lib/meta/graph-version"
import {
  bearer,
  graphRequest,
  WhatsappApiError,
} from "@/lib/meta/whatsapp-client"
import { log } from "@/lib/observability/logger"
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
// Solo lee. Crear, editar y borrar plantillas llega con el ticket 7.

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
