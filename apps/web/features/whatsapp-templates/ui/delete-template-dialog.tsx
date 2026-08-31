"use client"

import { useState, useTransition } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import { deleteWhatsappTemplateAction } from "@/features/whatsapp-templates/actions"
import type { WhatsappTemplateRowView } from "@/lib/whatsapp-templates/template-console"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"

// Borrar una plantilla propia.
//
// Es la operación más destructiva del producto y la única que no se deshace ni
// esperando, así que la confirmación dice las dos cosas que el usuario no sabe:
//
//   - **se borra sólo el idioma elegido.** Resender borra siempre por `hsm_id`,
//     nunca por nombre; el borrado por nombre que ofrece Meta se lleva todas las
//     versiones de idioma y este producto no lo expone (ADR 0014). Quien quiera
//     borrar cinco idiomas lo pide cinco veces.
//   - **el nombre queda inutilizable 30 días.** Es de Meta y no nuestro, y es lo
//     que convierte un borrado apresurado en un problema que dura un mes.
//
// La acción se invoca a mano con `useTransition` y no con `useActionState`, como
// el diálogo de revocar una API key: acá sí conviene cerrar al confirmar, porque
// la confirmación es que la fila desaparece de la lista de atrás.

export function DeleteTemplateDialog({
  template,
  pageId,
}: {
  template: WhatsappTemplateRowView
  pageId: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dict = useAppDict()
  const t = dict.templates

  function remove(formData: FormData) {
    startTransition(async () => {
      const result = await deleteWhatsappTemplateAction({}, formData)
      if (result.error) {
        setError(
          result.detail ? `${result.error} ${result.detail}` : result.error
        )
        return
      }
      setError(null)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          {t.remove.cta}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {fmt(t.remove.title, { name: template.name })}
          </DialogTitle>
          <DialogDescription>
            {fmt(t.remove.body, { language: template.language })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-warning-soft-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-[13px]/[1.5]">{t.remove.burnWarning}</p>
        </div>

        <form action={remove}>
          <input type="hidden" name="pageId" value={pageId} />
          <input type="hidden" name="templateId" value={template.id} />
          {error ? (
            <p className="text-[13px]/[1.5] text-destructive">{error}</p>
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
                  {t.remove.removing}
                </>
              ) : (
                t.remove.confirm
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
