"use client"

import { useActionState, useId, useState } from "react"
import { Check, LoaderCircle, Plus } from "lucide-react"

import { useAppDict } from "@/content/i18n/app/provider"
import {
  createWhatsappTemplateAction,
  type WhatsappTemplateActionState,
} from "@/features/whatsapp-templates/actions"
import { TemplateActionError } from "@/features/whatsapp-templates/ui/template-action-error"
import { TemplateFields } from "@/features/whatsapp-templates/ui/template-fields"
import { WHATSAPP_TEMPLATE_EDITABLE_CATEGORIES } from "@/lib/whatsapp-templates/template-admin"
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
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

// Crear una plantilla: nombre, idioma, categoría y el editor v1 —cuerpo con
// variables y pie opcional—.
//
// **Lo que no está y no es un olvido** (ADR 0014): el header con media exigiría
// que Resender hospede media saliente, que la ADR 0013 cerró con argumento
// propio; los botones y las plantillas `authentication` tienen forma y reglas
// propias. Las tres cosas se administran en WhatsApp Manager.
//
// El formulario **no se cierra solo al crear**. La creación tiene un desenlace
// que no se ve en la lista de atrás —«Meta la creó pero nuestro espejo no se
// enteró», y hasta el próximo sync la plantilla se ve ajena—, así que la
// respuesta se muestra donde el usuario está mirando. Al cerrar, el formulario
// se remonta con `key` para que el siguiente «Nueva plantilla» no herede ni el
// estado de la acción anterior ni lo que quedó escrito.

// Clases del `<select>` nativo, calcadas de `packages/ui/src/components/input`:
// la ADR 0007 no agrega componentes a `packages/ui` por un solo formulario.
const CONTROL_CLASS =
  "h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"

export function CreateTemplateDialog({ pageId }: { pageId: string }) {
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
        <Button type="button" size="lg">
          <Plus aria-hidden />
          {t.create.cta}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t.create.title}</DialogTitle>
          <DialogDescription>{t.create.body}</DialogDescription>
        </DialogHeader>
        <CreateTemplateForm
          key={formKey}
          pageId={pageId}
          onClose={() => change(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateTemplateForm({
  pageId,
  onClose,
}: {
  pageId: string
  onClose: () => void
}) {
  const [state, action, pending] = useActionState<
    WhatsappTemplateActionState,
    FormData
  >(createWhatsappTemplateAction, {})
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={fieldId("name")}>{t.create.nameLabel}</Label>
          <Input
            id={fieldId("name")}
            name="name"
            required
            maxLength={512}
            // El patrón es el de Meta, el mismo que aplica
            // `parseWhatsappTemplateDraft`: acá sólo adelanta el aviso al
            // navegador para no gastar un viaje en un rechazo seguro.
            pattern="[a-z0-9_]+"
            disabled={pending}
            placeholder={t.create.namePlaceholder}
          />
          <p className="text-[12.5px] text-muted-foreground">
            {t.create.nameHint}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={fieldId("language")}>{t.create.languageLabel}</Label>
          <Input
            id={fieldId("language")}
            name="language"
            required
            disabled={pending}
            placeholder={t.create.languagePlaceholder}
          />
          <p className="text-[12.5px] text-muted-foreground">
            {t.create.languageHint}
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={fieldId("category")}>{t.create.categoryLabel}</Label>
        <select
          id={fieldId("category")}
          name="category"
          required
          disabled={pending}
          defaultValue="utility"
          className={CONTROL_CLASS}
        >
          {/* Se itera la constante del dominio y no las claves del diccionario:
              el orden de un objeto no es contrato, y así `authentication` no
              puede colarse en el `select` por estar en el mapa de etiquetas. */}
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

      <TemplateFields disabled={pending} />

      <TemplateActionError state={state} />

      <DialogFooter>
        <Button type="button" variant="ghost" size="lg" onClick={onClose}>
          {dict.common.cancel}
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              {t.create.submitting}
            </>
          ) : (
            t.create.submit
          )}
        </Button>
      </DialogFooter>
    </form>
  )
}
