"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import { unlinkGoogleAction } from "@/features/account/actions"
import { useAppDict } from "@/content/i18n/app/provider"
import { Button } from "@workspace/ui/components/button"

// «Desvincular» Google desde Settings. Solo se dibuja cuando queda otra
// credencial (`summarizeAccounts().canRemoveGoogle`): la librería se niega a
// quitar la última y el panel no ofrece lo que no puede dar. `unlinkHint`
// avisa lo otro que la librería impone: sesión fresca.
export function UnlinkGoogleForm({ accountId }: { accountId: string }) {
  const [state, formAction, pending] = useActionState(unlinkGoogleAction, {})
  const t = useAppDict().account.signInMethods

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {/* Id de la **fila** de `auth_accounts`, que es lo que `unlinkAccount`
          compara; no el `sub` de Google. */}
      <input type="hidden" name="accountId" value={accountId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : null}
        {t.unlink}
      </Button>
      {state.error ? (
        <span role="alert" className="text-[13px] text-destructive">
          {state.error}
        </span>
      ) : (
        <span className="text-[12.5px] text-muted-foreground">
          {t.unlinkHint}
        </span>
      )}
    </form>
  )
}
