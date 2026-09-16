"use client"

import { useActionState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"

import { useAppDict } from "@/content/i18n/app/provider"
import {
  acceptInvitationAction,
  type AcceptInvitationState,
} from "@/features/clients/invitation-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Formulario de `/invitacion/[token]` (issue #154, ticket #156): nombre
// prellenado con el que puso el padre, contraseña y confirmación. Molde de
// `reset-password-form`: el token viaja en un input oculto porque el server
// action no ve la URL de la página. El correo se muestra pero no se edita: es
// el de la invitación.
export function AcceptInvitationForm({
  token,
  clientName,
  email,
}: {
  token: string
  clientName: string
  email: string
}) {
  const [state, formAction, pending] = useActionState<
    AcceptInvitationState,
    FormData
  >(acceptInvitationAction, {})
  const t = useAppDict().invitation
  const hasError = Boolean(state.error)

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-3.5">
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-2">
        <Label htmlFor="email">{t.emailLabel}</Label>
        {/* Solo lectura y sin `name`: el correo es el de la invitación y lo
            resuelve el servidor por el token, no el formulario. */}
        <Input id="email" type="email" value={email} readOnly />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="name">{t.nameLabel}</Label>
        <Input
          id="name"
          name="name"
          defaultValue={clientName}
          required
          disabled={pending}
          autoComplete="name"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">{t.passwordLabel}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={pending}
          aria-invalid={hasError}
          aria-describedby="password-hint"
          placeholder={t.passwordPlaceholder}
        />
        <p id="password-hint" className="text-[13px] text-muted-foreground">
          {t.passwordHint}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">{t.confirmPasswordLabel}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={pending}
          aria-invalid={hasError}
          placeholder={t.confirmPasswordPlaceholder}
        />
      </div>
      {state.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-soft-foreground"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {t.submitting}
          </>
        ) : (
          t.submit
        )}
      </Button>
    </form>
  )
}
