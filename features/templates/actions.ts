"use server"

import { revalidatePath } from "next/cache"

import { fmt, type AppDict } from "@/content/i18n/app"
import { resolveActionActor } from "@/lib/clients/action-actor"
import { getAppDict } from "@/lib/i18n/app-dict"
import type { WhatsappTemplateAdminFailure } from "@/lib/meta/whatsapp-template-client"
import { log } from "@/lib/observability/logger"
import {
  createTemplate,
  deleteTemplate,
  editTemplate,
} from "@/lib/whatsapp-templates/template-admin"
import {
  validateTemplateContent,
  validateTemplateDraft,
  type TemplateActor,
  type TemplateDraftErrorCode,
} from "@/lib/whatsapp-templates/template-draft"
import {
  readTemplateContentForm,
  readTemplateDraftForm,
  templateMetaErrorKey,
} from "@/lib/whatsapp-templates/template-editor"

// Crear, editar y borrar las [Plantilla]s propias desde la consola (issue
// #196). Es la vía del [Cliente], que no tiene API keys; el [Padre] también la
// usa. Llaman directo al dominio de la API pública (`template-admin`, issue
// #194) con el actor de la sesión, sin pasar por las rutas HTTP: la regla de
// dueño, la validación y el catálogo de errores de Meta son los mismos.
//
// Del formulario solo se confía en qué plantilla y qué contenido; el número
// (`phoneNumberId`) se vuelve a verificar contra el actor en el dominio, y una
// plantilla de una WABA que el actor no ve es «no encontramos», igual que un
// id inventado.

export type TemplateActionState = { error?: string; ok?: true }

export async function createTemplateAction(
  _prev: TemplateActionState,
  formData: FormData
): Promise<TemplateActionState> {
  const t = await getAppDict()
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const actor = toTemplateActor(who.actor)

  const draft = validateTemplateDraft(readTemplateDraftForm(formData))
  if (!draft.ok) return { error: draftError(t, draft.code) }

  const result = await createTemplate({
    actor,
    phoneNumberId: readString(formData, "phoneNumberId"),
    draft: draft.value,
  })
  switch (result.kind) {
    case "number_not_connected":
      return { error: t.templates.numberNotConnected }
    case "meta_rejected":
      return { error: metaError(t, result.failure) }
    case "created":
      log({
        entrypoint: "action",
        action: "template_create",
        outcome: "ok",
        tenantId: actor.tenantId,
        connectionId: result.page.id,
        channel: "whatsapp",
        accountId: result.template.wabaId,
      })
      revalidatePath("/templates")
      return { ok: true }
  }
}

export async function editTemplateAction(
  _prev: TemplateActionState,
  formData: FormData
): Promise<TemplateActionState> {
  const t = await getAppDict()
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const actor = toTemplateActor(who.actor)

  const templateId = readString(formData, "templateId")
  if (!templateId) return { error: t.templates.notFound }

  const content = validateTemplateContent(readTemplateContentForm(formData))
  if (!content.ok) return { error: draftError(t, content.code) }

  const result = await editTemplate({
    actor,
    phoneNumberId: readString(formData, "phoneNumberId"),
    templateId,
    content: content.value,
  })
  switch (result.kind) {
    case "meta_rejected":
      return { error: metaError(t, result.failure) }
    case "edited":
      log({
        entrypoint: "action",
        action: "template_edit",
        outcome: "ok",
        tenantId: actor.tenantId,
        connectionId: result.page.id,
        channel: "whatsapp",
        accountId: result.template.wabaId,
      })
      revalidatePath("/templates")
      return { ok: true }
    default:
      return { error: refusal(t, result.kind) }
  }
}

export async function deleteTemplateAction(
  _prev: TemplateActionState,
  formData: FormData
): Promise<TemplateActionState> {
  const t = await getAppDict()
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const actor = toTemplateActor(who.actor)

  const templateId = readString(formData, "templateId")
  if (!templateId) return { error: t.templates.notFound }

  const result = await deleteTemplate({
    actor,
    phoneNumberId: readString(formData, "phoneNumberId"),
    templateId,
  })
  switch (result.kind) {
    case "meta_rejected":
      return { error: metaError(t, result.failure) }
    case "deleted":
      log({
        entrypoint: "action",
        action: "template_delete",
        outcome: "ok",
        tenantId: actor.tenantId,
        connectionId: result.page.id,
        channel: "whatsapp",
        accountId: result.template.wabaId,
      })
      revalidatePath("/templates")
      return { ok: true }
    default:
      return { error: refusal(t, result.kind) }
  }
}

// El actor del dominio: solo el alcance, no el user.
function toTemplateActor(actor: TemplateActor): TemplateActor {
  return { tenantId: actor.tenantId, clientAccountId: actor.clientAccountId }
}

// Los rechazos de editar y borrar que no llaman a Meta.
function refusal(
  t: AppDict,
  kind:
    | "number_not_connected"
    | "not_found"
    | "not_owned"
    | "missing_meta_template_id"
): string {
  switch (kind) {
    case "number_not_connected":
      return t.templates.numberNotConnected
    case "not_found":
      return t.templates.notFound
    case "not_owned":
      return t.templates.notOwned
    case "missing_meta_template_id":
      return t.templates.missingMetaId
  }
}

function draftError(t: AppDict, code: TemplateDraftErrorCode): string {
  return t.templates.draftErrors[code]
}

// Traducido si Meta documenta el código; si no, el mensaje de Meta tal cual.
function metaError(t: AppDict, failure: WhatsappTemplateAdminFailure): string {
  const key = templateMetaErrorKey(failure)
  if (key) return t.templates.metaErrors[key]
  return fmt(t.templates.metaRejected, { message: failure.error })
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}
