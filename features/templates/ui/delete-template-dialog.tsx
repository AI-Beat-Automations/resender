"use client"

import { useState, useTransition } from "react"
import { LoaderCircle, Trash2 } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import { deleteTemplateAction } from "@/features/templates/actions"
import { templateConfirmation } from "@/lib/whatsapp-templates/template-editor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import {
  ConfirmationNotes,
  type EditableTemplate,
} from "./template-editor-dialog"

// Borrar una [Plantilla] propia (issue #196), en el molde de
// `revoke-api-key-dialog`. El aviso es lo importante: se borra solo ese idioma
// (por hsm id) y el nombre queda bloqueado 30 días en Meta. Si otros números
// ya la enviaron, se dice; informa, no bloquea.
export function DeleteTemplateDialog({
  phoneNumberId,
  template,
}: {
  phoneNumberId: string
  template: EditableTemplate
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dict = useAppDict()
  const t = dict.templates
  const confirmation = templateConfirmation("delete", template)

  function remove(formData: FormData) {
    startTransition(async () => {
      const result = await deleteTemplateAction({}, formData)
      if (result.error) {
        setError(result.error)
        return
      }
      setError(null)
      setOpen(false)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setError(null)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          <Trash2 aria-hidden />
          {t.delete}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {fmt(t.deleteTitle, {
              name: template.name,
              language: template.language,
            })}
          </DialogTitle>
          <DialogDescription>
            {fmt(t.deleteBody, { language: template.language })}
          </DialogDescription>
        </DialogHeader>
        {confirmation && confirmation.usedByOtherNumbers > 0 ? (
          <ConfirmationNotes
            usage={fmt(t.usedByOtherNumbers, {
              count: confirmation.usedByOtherNumbers,
            })}
          />
        ) : null}
        <form action={remove}>
          <input type="hidden" name="phoneNumberId" value={phoneNumberId} />
          <input type="hidden" name="templateId" value={template.id} />
          {error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg">
                {dict.common.cancel}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              size="lg"
              disabled={pending}
            >
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t.deleting}
                </>
              ) : (
                t.deleteConfirm
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
