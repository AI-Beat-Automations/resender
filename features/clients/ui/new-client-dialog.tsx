"use client"

import { useActionState, useState } from "react"
import { LoaderCircle, Plus } from "lucide-react"

import {
  createAgencyClientAction,
  type ClientActionState,
} from "@/features/clients/actions"
import { useAppDict } from "@/content/i18n/app/provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CLIENT_NAME_MAX_LENGTH } from "@/lib/clients/client-name"

// «Nuevo cliente» en la cabecera de Conexiones (ADR 0020). Solo lo dibuja el
// dueño; la acción además lo verifica.
export function NewClientDialog() {
  const t = useAppDict()
  const [open, setOpen] = useState(false)
  // Se cierra solo cuando la acción terminó bien, desde la propia acción y no
  // desde un efecto que reaccione a su resultado.
  const [state, action, pending] = useActionState<ClientActionState, FormData>(
    async (previous, formData) => {
      const result = await createAgencyClientAction(previous, formData)
      if (result.doneAt) setOpen(false)
      return result
    },
    {}
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="default">
          <Plus aria-hidden />
          {t.clients.newClient}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.clients.createTitle}</DialogTitle>
          <DialogDescription>{t.clients.createBody}</DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="agency-client-name">{t.clients.nameLabel}</Label>
            <Input
              id="agency-client-name"
              name="name"
              required
              maxLength={CLIENT_NAME_MAX_LENGTH}
              placeholder={t.clients.namePlaceholder}
            />
          </div>
          {state.error ? (
            <p className="text-[12.5px] text-[var(--danger-text)]">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            {pending ? t.clients.creating : t.clients.create}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
