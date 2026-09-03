"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import { linkGoogleAction } from "@/features/account/actions"
import { useAppDict } from "@/content/i18n/app/provider"
import { Button } from "@workspace/ui/components/button"

// «Vincular» Google desde Settings ([Cuenta vinculada]). Con el correo sin
// confirmar el botón va deshabilitado y el motivo al lado. Es UX, no el
// candado: el que corta de verdad es `linkGoogleAction`, porque en este
// camino la librería no revisa el `email_verified` de la cuenta local.
export function LinkGoogleForm({ verified }: { verified: boolean }) {
  const [state, formAction, pending] = useActionState(linkGoogleAction, {})
  const t = useAppDict().account.signInMethods

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending || !verified}
        aria-describedby={verified ? undefined : "link-google-hint"}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : null}
        {t.link}
      </Button>
      {!verified ? (
        <span
          id="link-google-hint"
          className="text-[12.5px] text-muted-foreground"
        >
          {t.linkRequiresVerified}
        </span>
      ) : null}
      {state.error ? (
        <span role="alert" className="text-[13px] text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}
