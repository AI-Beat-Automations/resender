import type { ConnectedPageRecord } from "@/lib/pages/page-registry"

import { canManageTemplate, type TemplateActor } from "./template-draft"
import type {
  WhatsappTemplateRecord,
  WhatsappTemplateStatus,
} from "./template-store"

// Qué [Plantilla]s ve cada [Actor] en la consola (issue #195). Puro: la
// página trae los números y el catálogo, y esto decide.
//
// La plantilla vive en la WABA y no en el número, así que se ve el catálogo de
// las WABAs donde el actor tiene un número de WhatsApp activo: el [Padre], las
// de todos los números del tenant (los suyos y los de sus clientes); el
// [Cliente], solo las de sus números. `listTenantPages` ya trae la lista con
// ese alcance; el filtro se repite acá para que la regla no dependa de cómo se
// llamó a la base.

export type TemplateNumber = {
  /** El id de la conexión (`connected_pages.id`), el que va en `?number=`. */
  id: string
  wabaId: string
  /** El número en E.164, o el nombre de la conexión si no lo tiene. */
  label: string
}

export function templateNumbersForActor(
  pages: Pick<
    ConnectedPageRecord,
    | "id"
    | "tenantId"
    | "clientAccountId"
    | "channel"
    | "status"
    | "wabaId"
    | "whatsappPhoneE164"
    | "name"
  >[],
  actor: TemplateActor
): TemplateNumber[] {
  const numbers: TemplateNumber[] = []
  for (const page of pages) {
    if (page.channel !== "whatsapp" || page.status !== "active") continue
    if (!page.wabaId || page.tenantId !== actor.tenantId) continue
    if (
      actor.clientAccountId !== null &&
      page.clientAccountId !== actor.clientAccountId
    ) {
      continue
    }
    numbers.push({
      id: page.id,
      wabaId: page.wabaId,
      label: page.whatsappPhoneE164 ?? page.name,
    })
  }
  return numbers
}

/**
 * El número elegido en `?number=`. Uno que no es del actor —o sin parámetro—
 * cae en el primero: la URL la escribe el usuario y no abre otro catálogo.
 */
export function resolveTemplateNumber(
  numbers: TemplateNumber[],
  param: string | undefined
): TemplateNumber | null {
  return numbers.find((number) => number.id === param) ?? numbers[0] ?? null
}

export type TemplateRowView = {
  id: string
  name: string
  language: string
  category: WhatsappTemplateRecord["category"]
  status: WhatsappTemplateStatus
  body: string | null
  /**
   * La creó este mismo actor desde Resender: la misma regla que editar y
   * borrar (`canManageTemplate`). Lo demás es de solo lectura y se edita en
   * WhatsApp Manager.
   */
  owned: boolean
}

export function toTemplateRows(
  templates: WhatsappTemplateRecord[],
  actor: TemplateActor
): TemplateRowView[] {
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    body: template.body,
    owned: canManageTemplate(template, actor),
  }))
}

export type TemplateStatusTone =
  | "success"
  | "info"
  | "warning"
  | "destructiveSoft"
  | "outline"

/** El color del badge: aprobada, en revisión, frenada, caída o desconocida. */
export function templateStatusTone(
  status: WhatsappTemplateStatus
): TemplateStatusTone {
  switch (status) {
    case "APPROVED":
      return "success"
    case "PENDING":
    case "IN_REVIEW":
    case "IN_APPEAL":
      return "info"
    case "PAUSED":
    case "LIMIT_EXCEEDED":
    case "ARCHIVED":
      return "warning"
    case "REJECTED":
    case "DISABLED":
    case "PENDING_DELETION":
    case "DELETED":
      return "destructiveSoft"
    case "unknown":
      return "outline"
  }
}
