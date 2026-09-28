import {
  createWhatsappTemplate,
  deleteWhatsappTemplate,
  editWhatsappTemplate,
  type WhatsappTemplateAdminFailure,
} from "@/lib/meta/whatsapp-template-client"
import { describeError, log } from "@/lib/observability/logger"
import {
  getActiveWhatsappNumberWithTokenForActor,
  type ConnectedPageRecord,
} from "@/lib/pages/page-registry"

import {
  buildTemplateComponents,
  canManageTemplate,
  type TemplateActor,
  type TemplateContent,
  type TemplateDraft,
} from "./template-draft"
import {
  countTemplateUsageByOtherNumbers,
  deleteWhatsappTemplateById,
  getWhatsappTemplateById,
  insertOwnedWhatsappTemplate,
  updateWhatsappTemplateContent,
  type WhatsappTemplateRecord,
} from "./template-store"

// Crear, editar y borrar las [Plantilla]s propias (issue #194). Recibe el
// **actor** `{ tenantId, clientAccountId }` y no un request: la API pública lo
// arma con la API key (el [Padre], `clientAccountId` null) y la server action
// del ticket 9 con la sesión, y las dos llaman acá directo.
//
// El número (`phoneNumberId`) lo dice quien llama; la WABA se resuelve de este
// lado y tiene que ser la de la plantilla. Una plantilla de una WABA que el
// actor no ve es `not_found`, igual que una que no existe: no se confirma que
// exista.
//
// Devuelve un resultado por caso y no lanza por reglas de negocio: cada caso
// tiene su HTTP en la ruta y su mensaje en la UI.

type NumberNotConnected = { kind: "number_not_connected" }
type TemplateNotFound = { kind: "not_found" }
type TemplateNotOwned = { kind: "not_owned" }
type MissingMetaTemplateId = { kind: "missing_meta_template_id" }
type MetaRejected = {
  kind: "meta_rejected"
  failure: WhatsappTemplateAdminFailure
}

export type CreateTemplateResult =
  | NumberNotConnected
  | (MetaRejected & { page: ConnectedPageRecord })
  | {
      kind: "created"
      page: ConnectedPageRecord
      template: WhatsappTemplateRecord
    }

export type EditTemplateResult =
  | NumberNotConnected
  | TemplateNotFound
  | TemplateNotOwned
  | MissingMetaTemplateId
  | (MetaRejected & { page: ConnectedPageRecord })
  | {
      kind: "edited"
      page: ConnectedPageRecord
      template: WhatsappTemplateRecord
      // Era `APPROVED` y la edición la manda de nuevo a revisión: hasta que
      // Meta la apruebe otra vez no se puede enviar.
      reviewRequired: boolean
      usedByOtherNumbers: number
    }

export type DeleteTemplateResult =
  | NumberNotConnected
  | TemplateNotFound
  | TemplateNotOwned
  | MissingMetaTemplateId
  | (MetaRejected & { page: ConnectedPageRecord })
  | {
      kind: "deleted"
      page: ConnectedPageRecord
      template: WhatsappTemplateRecord
      usedByOtherNumbers: number
    }

export async function createTemplate(input: {
  actor: TemplateActor
  phoneNumberId: string
  draft: TemplateDraft
}): Promise<CreateTemplateResult> {
  const number = await getActiveWhatsappNumberWithTokenForActor({
    ...input.actor,
    phoneNumberId: input.phoneNumberId,
  })
  if (!number) return { kind: "number_not_connected" }

  const { draft } = input
  const created = await createWhatsappTemplate(
    number.pageAccessToken,
    number.wabaId,
    {
      name: draft.name,
      language: draft.language,
      category: draft.category,
      components: buildTemplateComponents(draft),
    }
  )
  if (!created.ok) {
    return { kind: "meta_rejected", page: number.page, failure: created }
  }

  // Si esto falla, la plantilla existe en Meta sin fila: el próximo sync la
  // trae sin dueño, de solo lectura. Se deja salir para que la ruta conteste
  // 500 y quede el rastro.
  const template = await insertOwnedWhatsappTemplate({
    wabaId: number.wabaId,
    name: draft.name,
    language: draft.language,
    metaTemplateId: created.metaTemplateId,
    category: draft.category,
    status: created.status,
    body: draft.body.text,
    createdByTenantId: input.actor.tenantId,
    createdByClientAccountId: input.actor.clientAccountId,
  })

  return { kind: "created", page: number.page, template }
}

export async function editTemplate(input: {
  actor: TemplateActor
  phoneNumberId: string
  templateId: string
  content: TemplateContent
}): Promise<EditTemplateResult> {
  const resolved = await resolveManagedTemplate(input)
  if (resolved.kind !== "ok") return resolved
  const { number, template, metaTemplateId } = resolved

  const usedByOtherNumbers = await countTemplateUsageByOtherNumbers({
    wabaId: number.wabaId,
    name: template.name,
    language: template.language,
    actor: input.actor,
  })

  const edited = await editWhatsappTemplate(number.pageAccessToken, {
    wabaId: number.wabaId,
    metaTemplateId,
    components: buildTemplateComponents(input.content),
  })
  if (!edited.ok) {
    return { kind: "meta_rejected", page: number.page, failure: edited }
  }

  // Meta contesta `{ success: true }` sin estado: toda edición vuelve a
  // revisión, así que la copia queda `PENDING` hasta que el webhook de estado
  // (issue #193) diga otra cosa.
  const updated = await updateWhatsappTemplateContent({
    id: template.id,
    body: input.content.body.text,
    status: "PENDING",
  })

  return {
    kind: "edited",
    page: number.page,
    template: updated ?? template,
    reviewRequired: template.status === "APPROVED",
    usedByOtherNumbers,
  }
}

export async function deleteTemplate(input: {
  actor: TemplateActor
  phoneNumberId: string
  templateId: string
}): Promise<DeleteTemplateResult> {
  const resolved = await resolveManagedTemplate(input)
  if (resolved.kind !== "ok") return resolved
  const { number, template, metaTemplateId } = resolved

  const usedByOtherNumbers = await countTemplateUsageByOtherNumbers({
    wabaId: number.wabaId,
    name: template.name,
    language: template.language,
    actor: input.actor,
  })

  // Siempre por `hsm_id`: borra solo este idioma.
  const deleted = await deleteWhatsappTemplate(number.pageAccessToken, {
    wabaId: number.wabaId,
    metaTemplateId,
    name: template.name,
  })
  if (!deleted.ok) {
    return { kind: "meta_rejected", page: number.page, failure: deleted }
  }

  // Meta ya la borró, que es lo que importa. Si la fila no se pudo borrar, el
  // webhook de estado o el próximo sync la dejan `DELETED`: no se le contesta
  // un error al cliente por algo que sí pasó.
  try {
    await deleteWhatsappTemplateById(template.id)
  } catch (error) {
    log({
      entrypoint: "route",
      action: "template_delete",
      outcome: "failed",
      reason: "internal_error",
      tenantId: input.actor.tenantId,
      connectionId: number.page.id,
      channel: "whatsapp",
      accountId: number.wabaId,
      errorMessage: `template row delete: ${describeError(error)}`,
    })
  }

  return { kind: "deleted", page: number.page, template, usedByOtherNumbers }
}

// Lo común de editar y borrar, en este orden: el número es del actor, la
// plantilla existe en su WABA, es suya y tiene hsm id. Nada de esto llama a
// Meta.
async function resolveManagedTemplate(input: {
  actor: TemplateActor
  phoneNumberId: string
  templateId: string
}) {
  const number = await getActiveWhatsappNumberWithTokenForActor({
    ...input.actor,
    phoneNumberId: input.phoneNumberId,
  })
  if (!number) return { kind: "number_not_connected" as const }

  const template = await getWhatsappTemplateById(input.templateId)
  if (!template || template.wabaId !== number.wabaId) {
    return { kind: "not_found" as const }
  }

  if (!canManageTemplate(template, input.actor)) {
    return { kind: "not_owned" as const }
  }

  // Sin hsm id no se borra ni se edita: el borrado por nombre se llevaría
  // todos los idiomas y bloquearía el nombre 30 días, y la edición es por id.
  // **Nunca** se cae al nombre.
  if (!template.metaTemplateId) {
    return { kind: "missing_meta_template_id" as const }
  }

  return {
    kind: "ok" as const,
    number,
    template,
    metaTemplateId: template.metaTemplateId,
  }
}
