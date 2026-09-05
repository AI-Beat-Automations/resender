"use client"

import { useActionState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"

import { unlinkGoogleAction } from "@/features/account/actions"
import { useAppDict } from "@/content/i18n/app/provider"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

// «Desvincular» Google desde Settings. Solo se dibuja cuando queda otra
// credencial (`summarizeAccounts().canRemoveGoogle`): la librería se niega a
// quitar la última y el panel no ofrece lo que no puede dar. `unlinkHint`
// avisa lo otro que la librería impone: sesión fresca.
export function UnlinkGoogleForm({ accountId }: { accountId: string }) {
  const [state, formAction, pending] = useActionState(unlinkGoogleAction, {})
  const t = useAppDict().account.signInMethods

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center justify-end gap-2"
    >
      {/* Id de la **fila** de `auth_accounts`, que es lo que `unlinkAccount`
          compara; no el `sub` de Google. */}
      <input type="hidden" name="accountId" value={accountId} />
      <span className="text-[12.5px] text-muted-foreground">
        {t.unlinkHint}
      </span>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : null}
        {t.unlink}
      </Button>
      {state.error ? (
        <Alert variant="destructive" role="alert" className="basis-full">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">{state.error}</AlertTitle>
        </Alert>
      ) : null}
    </form>
  )
}
