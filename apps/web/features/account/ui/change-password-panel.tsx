"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import {
  changePasswordAction,
  type ChangePasswordState,
} from "@/features/account/actions"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

export function ChangePasswordPanel() {
  const [state, action, pending] = useActionState<
    ChangePasswordState,
    FormData
  >(changePasswordAction, {})

  return (
    <SettingsCard>
      <SettingsCardTitle>Cambiar contraseña</SettingsCardTitle>
      {/* El cierre de sesión se avisa antes, no después: `changePasswordAction`
          termina en `signOut({ redirectTo: "/login?passwordChanged=1" })`. */}
      <p className="mt-1 max-w-140 text-[13.5px]/[1.55] text-muted-foreground">
        Define una contraseña nueva. Al guardarla cerramos tu sesión y tendrás
        que iniciar de nuevo.
      </p>
      <form action={action} className="mt-4 max-w-140">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="newPassword">Contraseña nueva</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="Al menos 8 caracteres"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">Repetir contraseña</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="Repite la contraseña nueva"
            />
          </div>
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Mínimo 8 caracteres.
        </p>
        <Button type="submit" size="lg" className="mt-4" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              Guardando…
            </>
          ) : (
            "Cambiar contraseña"
          )}
        </Button>
        {state.error ? (
          <p className="mt-3 text-[13px] text-destructive">{state.error}</p>
        ) : null}
      </form>
    </SettingsCard>
  )
}
