"use client"

import { useActionState } from "react"

import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/features/account/actions"
import { Button } from "@workspace/ui/components/button"

export function DeleteAccountPanel({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccountAction,
    {}
  )

  return (
    <section className="rounded-2xl border border-destructive/40 bg-card p-6 shadow-sm">
      <h2 className="font-medium text-destructive">Eliminar cuenta</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Borra de forma permanente tu cuenta y todos tus datos: paginas
        conectadas, conversaciones, mensajes y API keys. Antes de borrar
        intentamos dar de baja tus paginas del webhook de Meta. La accion es
        inmediata y no se puede deshacer; los backups se purgan en un plazo de 30
        dias.
      </p>
      <form
        action={action}
        onSubmit={(event) => {
          const ok = window.confirm(
            "Esto borra tu cuenta y todos tus datos de forma permanente. Continuar?"
          )
          if (!ok) event.preventDefault()
        }}
        className="mt-4 grid gap-3 sm:max-w-md"
      >
        <label className="text-sm font-medium" htmlFor="confirmEmail">
          Escribe <span className="font-mono">{email}</span> para confirmar
        </label>
        <input
          id="confirmEmail"
          name="confirmEmail"
          type="email"
          autoComplete="off"
          required
          placeholder={email}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Eliminando..." : "Eliminar cuenta"}
        </Button>
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
      </form>
    </section>
  )
}
