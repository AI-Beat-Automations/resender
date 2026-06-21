"use client"

import { useActionState } from "react"

import {
  changePasswordAction,
  type ChangePasswordState,
} from "@/features/account/actions"
import { Button } from "@workspace/ui/components/button"

export function ChangePasswordPanel() {
  const [state, action, pending] = useActionState<
    ChangePasswordState,
    FormData
  >(changePasswordAction, {})

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="font-medium">Cambiar password</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Define un password nuevo para tu cuenta. Al guardarlo, cerraremos tu
        sesion y tendras que iniciar sesion de nuevo.
      </p>
      <form action={action} className="mt-4 grid gap-3 sm:max-w-md">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="newPassword">
            Nuevo password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Minimo 8 caracteres"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="confirmPassword">
            Confirmar password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Repite el password nuevo"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Actualizando..." : "Cambiar password"}
        </Button>
        {state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}
      </form>
    </section>
  )
}
