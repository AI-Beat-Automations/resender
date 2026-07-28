"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/features/account/actions"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
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
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

// Zona de peligro de la pestaña Cuenta (B6): tarjeta orlada en rojo, separada
// del resto, y la confirmación en diálogo en vez de `window.confirm`
// (ADR 0005). Sigue exigiendo escribir el email exacto de la cuenta.
export function DeleteAccountPanel({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccountAction,
    {}
  )

  return (
    <SettingsCard className="border-destructive-soft-border">
      <SettingsCardTitle className="text-[var(--danger-text)]">
        Eliminar cuenta
      </SettingsCardTitle>
      <p className="mt-1.5 max-w-160 text-[13.5px]/[1.6] text-muted-foreground">
        Borra definitivamente tu cuenta y todos tus datos: páginas conectadas,
        conversaciones, mensajes y API keys. Antes de borrar intentamos
        desuscribir tus páginas del webhook de Meta. Es inmediato y no se puede
        deshacer; las copias de respaldo se purgan en 30 días.
      </p>

      <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="mt-4"
          >
            Eliminar cuenta
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar tu cuenta</DialogTitle>
            <DialogDescription>
              Se borran tu cuenta, tus páginas conectadas, tus conversaciones,
              tus mensajes y tus API keys. Es inmediato y no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-2">
            <Label htmlFor="confirmEmail">
              Escribe <span className="font-mono text-xs">{email}</span> para
              confirmar
            </Label>
            <Input
              id="confirmEmail"
              name="confirmEmail"
              type="email"
              autoComplete="off"
              required
              placeholder={email}
              className="w-full"
            />
            {state.error ? (
              <p className="text-[13px] text-destructive">{state.error}</p>
            ) : null}
            <DialogFooter className="mt-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="lg">
                  Cancelar
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
                    Eliminando…
                  </>
                ) : (
                  "Sí, eliminar mi cuenta"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}
