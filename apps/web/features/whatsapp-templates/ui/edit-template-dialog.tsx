"use client"

import { useActionState, useId, useState } from "react"
import { Check, LoaderCircle, TriangleAlert } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  updateWhatsappTemplateAction,
  type WhatsappTemplateActionState,
} from "@/features/whatsapp-templates/actions"
import { TemplateActionError } from "@/features/whatsapp-templates/ui/template-action-error"
import { TemplateFields } from "@/features/whatsapp-templates/ui/template-fields"
import { WHATSAPP_TEMPLATE_EDITABLE_CATEGORIES } from "@/lib/whatsapp-templates/template-admin"
import type { WhatsappTemplateRowView } from "@/lib/whatsapp-templates/template-console"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Label } from "@workspace/ui/components/label"

// Editar el contenido de una plantilla propia.
//
// **El aviso de que vuelve a revisión está antes de guardar y no en la
// respuesta** (user story 5 del issue #79). Cuando la acción contesta, la
// plantilla ya está editada y ya dejó de poder enviarse: avisar ahí sería
// contarle al usuario algo que ya no puede decidir. Por eso el aviso se pinta al
// abrir el diálogo, y sólo cuando la plantilla está aprobada —que es cuando
// editar tiene una consecuencia que perder—.
//
// **El formulario abre vacío, y no es un bug.** El espejo guarda `(waba_id,
// name, language, status)` y no los `components`: el contenido es de Meta y una
// copia que deriva mentiría sobre lo que se va a entregar (ADR 0014). Así que lo
// que se escriba acá **reemplaza** la plantilla entera, y el diálogo lo dice en
// su descripción en vez de dejar que alguien crea que está completando lo que ya
// había.

const CONTROL_CLASS =
  "h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"

export function EditTemplateDialog({
  template,
  pageId,
}: {
  template: WhatsappTemplateRowView
  pageId: string
}) {
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const t = useAppDict().templates

  function change(next: boolean) {
    setOpen(next)
    if (!next) setFormKey((key) => key + 1)
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t.edit.cta}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {fmt(t.edit.title, {
              name: template.name,
              language: template.language,
            })}
          </DialogTitle>
          <DialogDescription>{t.edit.body}</DialogDescription>
        </DialogHeader>
        <EditTemplateForm
          key={formKey}
          template={template}
          pageId={pageId}
          onClose={() => change(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditTemplateForm({
  template,
  pageId,
  onClose,
}: {
  template: WhatsappTemplateRowView
  pageId: string
  onClose: () => void
}) {
  const [state, action, pending] = useActionState<
    WhatsappTemplateActionState,
    FormData
  >(updateWhatsappTemplateAction, {})
  const dict = useAppDict()
  const t = dict.templates
  const id = useId()
  const fieldId = (name: string) => `${id}-${name}`

  if (state.message) {
    return (
      <>
        <div className="flex items-start gap-3 rounded-lg border border-success-soft-border bg-success-soft px-4 py-3 text-success-soft-foreground">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-[13.5px]/[1.5]">{state.message}</p>
        </div>
        <DialogFooter>
          <Button type="button" size="lg" onClick={onClose}>
            {dict.common.close}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="templateId" value={template.id} />

      {/* El aviso, antes de tocar nada: una plantilla aprobada deja de poder
          enviarse en cuanto se guarda, hasta que Meta la re-apruebe. */}
      {template.returnsToReviewOnEdit && (
        <div className="flex items-start gap-3 rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-warning-soft-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="text-[13px]/[1.5]">
            <p className="font-medium">{t.edit.approvedWarningTitle}</p>
            <p className="mt-0.5">{t.edit.approvedWarningBody}</p>
          </div>
        </div>
      )}

      <TemplateFields disabled={pending} />

      <div className="grid gap-1.5">
        <Label htmlFor={fieldId("category")}>{t.create.categoryLabel}</Label>
        <select
          id={fieldId("category")}
          name="category"
          disabled={pending}
          defaultValue=""
          className={CONTROL_CLASS}
        >
          {/* La cadena vacía es «dejala como está», que es lo que quiere casi
              todo el mundo al editar: la acción la convierte en ausencia y Meta
              no toca la categoría. */}
          <option value="">{t.edit.categoryKeep}</option>
          {WHATSAPP_TEMPLATE_EDITABLE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t.categoryLabel[category]}
            </option>
          ))}
        </select>
        <p className="text-[12.5px] text-muted-foreground">
          {t.create.categoryHint}
        </p>
      </div>

      <TemplateActionError state={state} />

      <DialogFooter>
        <Button type="button" variant="ghost" size="lg" onClick={onClose}>
          {dict.common.cancel}
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              {t.edit.submitting}
            </>
          ) : (
            t.edit.submit
          )}
        </Button>
      </DialogFooter>
    </form>
  )
}
