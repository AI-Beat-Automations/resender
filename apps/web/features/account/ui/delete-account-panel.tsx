"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"
import { usePostHog } from "posthog-js/react"

import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/features/account/actions"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import { useAppDict } from "@/content/i18n/app/provider"
import { isPostHogEnabled } from "@/lib/posthog-client"
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
  const posthog = usePostHog()
  const dict = useAppDict()
  const t = dict.account

  // Mismo patrón que `change-password-panel`: el `reset()` se adelanta porque el
  // camino feliz termina en un redirect, y si la acción devuelve error se
  // recupera la identidad. Aquí pesa más que allí: el email mal escrito es un
  // resultado rutinario de este diálogo, no un caso raro.
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    async (previousState, formData) => {
      const previousDistinctId = isPostHogEnabled
        ? posthog.get_distinct_id()
        : undefined
      if (isPostHogEnabled) posthog.reset()

      const result = await deleteAccountAction(previousState, formData)

      if (result.error && previousDistinctId) {
        posthog.identify(previousDistinctId)
      }
      return result
    },
    {}
  )

  return (
    <SettingsCard className="border-destructive-soft-border">
      <SettingsCardTitle className="text-[var(--danger-text)]">
        {t.deleteTitle}
      </SettingsCardTitle>
      <p className="mt-1.5 max-w-160 text-[13.5px]/[1.6] text-muted-foreground">
        {t.deleteBody}
      </p>

      <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="mt-4"
          >
            {t.deleteCta}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deleteDialogTitle}</DialogTitle>
            <DialogDescription>{t.deleteDialogBody}</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-2">
            <Label htmlFor="confirmEmail">
              {t.deleteConfirmBefore}
              <span className="font-mono text-xs">{email}</span>
              {t.deleteConfirmAfter}
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
                    {t.deleting}
                  </>
                ) : (
                  t.deleteConfirm
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}
