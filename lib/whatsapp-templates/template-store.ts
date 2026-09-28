import { getSql } from "@/lib/db"
import type {
  WhatsappTemplateCategory,
  WhatsappTemplateListing,
} from "@/lib/meta/whatsapp-template-client"

// La copia local del catálogo de [Plantilla]s (migración 0032, ADR 0024).
//
// **La copia no decide qué se envía**: sirve para listar, para saber si una
// plantilla está aprobada y para que el Inbox muestre el cuerpo. Una fila por
// `(waba_id, name, language)`; la plantilla es de la WABA, no del número.

// Los estados que Meta documenta, más los que se vieron en la práctica. El
// catálogo no es estable, por eso la columna no tiene check y lo que no está
// acá se lee como `unknown` en vez de romper la lectura.
export const WHATSAPP_TEMPLATE_STATUSES = [
  "APPROVED",
  "PENDING",
  "IN_REVIEW",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "LIMIT_EXCEEDED",
  "PENDING_DELETION",
  "DELETED",
] as const

export type WhatsappTemplateStatus =
  | (typeof WHATSAPP_TEMPLATE_STATUSES)[number]
  | "unknown"

export function normalizeWhatsappTemplateStatus(
  value: string | null | undefined
): WhatsappTemplateStatus {
  const status = value?.trim().toUpperCase()
  return (WHATSAPP_TEMPLATE_STATUSES as readonly string[]).includes(
    status ?? ""
  )
    ? (status as WhatsappTemplateStatus)
    : "unknown"
}

export type WhatsappTemplateRecord = {
  id: string
  wabaId: string
  name: string
  language: string
  metaTemplateId: string | null
  category: WhatsappTemplateCategory | null
  status: WhatsappTemplateStatus
  body: string | null
  // El dueño: quien la creó desde Resender. Null en las que trajo el sync.
  createdByTenantId: string | null
  createdByClientAccountId: string | null
  syncedAt: Date
  createdAt: Date
}

type TemplateRow = {
  id: string
  waba_id: string
  name: string
  language: string
  meta_template_id: string | null
  category: WhatsappTemplateCategory | null
  status: string
  body: string | null
  created_by_tenant_id: string | null
  created_by_client_account_id: string | null
  synced_at: Date | string
  created_at: Date | string
}

/**
 * Si la plantilla es del [Padre] de este tenant. La API es del padre, así que
 * una plantilla creada por uno de sus [Cliente]s no es «suya» aunque cuelgue
 * del mismo tenant.
 */
export function isOwnedByParent(
  template: Pick<
    WhatsappTemplateRecord,
    "createdByTenantId" | "createdByClientAccountId"
  >,
  tenantId: string
): boolean {
  return (
    template.createdByTenantId === tenantId &&
    template.createdByClientAccountId === null
  )
}

/** El catálogo de una WABA, ordenado por nombre e idioma. */
export async function listWhatsappTemplatesForWaba(
  wabaId: string
): Promise<WhatsappTemplateRecord[]> {
  const sql = getSql()
  const rows = await sql<TemplateRow[]>`
    select id, waba_id, name, language, meta_template_id, category, status,
      body, created_by_tenant_id, created_by_client_account_id, synced_at,
      created_at
    from whatsapp_templates
    where waba_id = ${wabaId}
    order by name, language
  `
  return rows.map(mapTemplate)
}

export async function findWhatsappTemplate(input: {
  wabaId: string
  name: string
  language: string
}): Promise<WhatsappTemplateRecord | null> {
  const sql = getSql()
  const [row] = await sql<TemplateRow[]>`
    select id, waba_id, name, language, meta_template_id, category, status,
      body, created_by_tenant_id, created_by_client_account_id, synced_at,
      created_at
    from whatsapp_templates
    where waba_id = ${input.wabaId}
      and name = ${input.name}
      and language = ${input.language}
    limit 1
  `
  return row ? mapTemplate(row) : null
}

// Filas por statement. Una WABA llega a 6.000 plantillas, y un cuerpo hasta
// 1.024 caracteres: en tandas, el request al driver HTTP no crece sin techo.
const UPSERT_CHUNK = 500

/**
 * Guarda lo que trajo el sync. Idempotente: un segundo sync de la misma WABA
 * —desde otro número, o el reintento de la cola— cae sobre las mismas filas.
 *
 * **Nunca toca `created_by_*`**: el sync no sabe quién creó una plantilla, y
 * pisarlo con null volvería ajena una propia. Una fila nueva entra sin dueño.
 */
export async function upsertSyncedWhatsappTemplates(input: {
  wabaId: string
  templates: WhatsappTemplateListing[]
}): Promise<number> {
  // Meta no debería repetir `(name, language)`, pero si lo hiciera el
  // `on conflict` tocaría la misma fila dos veces en un statement y fallaría
  // el lote entero. Gana la última.
  const unique = [
    ...new Map(
      input.templates.map((template) => [
        `${template.name}\u0000${template.language}`,
        template,
      ])
    ).values(),
  ]

  const sql = getSql()
  for (let start = 0; start < unique.length; start += UPSERT_CHUNK) {
    const chunk = unique.slice(start, start + UPSERT_CHUNK)
    await sql`
      insert into whatsapp_templates (
        waba_id, name, language, meta_template_id, category, status, body
      )
      select ${input.wabaId}, t.name, t.language, t.meta_template_id,
        t.category, t.status, t.body
      from unnest(
        ${chunk.map((t) => t.name)}::text[],
        ${chunk.map((t) => t.language)}::text[],
        ${chunk.map((t) => t.metaTemplateId)}::text[],
        ${chunk.map((t) => t.category)}::text[],
        ${chunk.map((t) => t.status)}::text[],
        ${chunk.map((t) => t.body)}::text[]
      ) as t(name, language, meta_template_id, category, status, body)
      on conflict (waba_id, name, language) do update set
        meta_template_id = coalesce(
          excluded.meta_template_id,
          whatsapp_templates.meta_template_id
        ),
        category = excluded.category,
        status = excluded.status,
        body = excluded.body,
        synced_at = now()
    `
  }

  return unique.length
}

function mapTemplate(row: TemplateRow): WhatsappTemplateRecord {
  return {
    id: row.id,
    wabaId: row.waba_id,
    name: row.name,
    language: row.language,
    metaTemplateId: row.meta_template_id,
    category: row.category,
    status: normalizeWhatsappTemplateStatus(row.status),
    body: row.body,
    createdByTenantId: row.created_by_tenant_id,
    createdByClientAccountId: row.created_by_client_account_id,
    syncedAt: new Date(row.synced_at),
    createdAt: new Date(row.created_at),
  }
}
