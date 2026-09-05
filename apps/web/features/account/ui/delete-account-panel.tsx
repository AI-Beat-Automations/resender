"use client"

import { useActionState, useState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"
import { usePostHog } from "posthog-js/react"

import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/features/account/actions"
import { useAppDict } from "@/content/i18n/app/provider"
import { isPostHogEnabled } from "@/lib/posthog-client"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

// Zona de peligro de la pestaña Cuenta (B6, mock 1j): tarjeta orlada en rojo,
// separada del resto, con el botón a la derecha y la confirmación en
// `AlertDialog` (ADR 0015) en vez de `window.confirm`. Sigue exigiendo escribir
// el email exacto de la cuenta.
export function DeleteAccountPanel({ email }: { email: string }) {
  const posthog = usePostHog()
  const dict = useAppDict()
  const t = dict.account
  const [open, setOpen] = useState(false)

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
    <Card className="ring-destructive/30">
      <CardHeader className="items-center gap-x-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle className="font-semibold text-destructive">
          {t.deleteTitle}
        </CardTitle>
        <CardDescription className="text-[13px]/[1.5]">
          {t.deleteBody}
        </CardDescription>
        <CardAction className="self-center">
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                {t.deleteCta}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.deleteDialogTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t.deleteDialogBody}
                </AlertDialogDescription>
              </AlertDialogHeader>
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
                  <Alert variant="destructive" role="alert">
                    <TriangleAlert aria-hidden />
                    <AlertTitle className="font-normal">
                      {state.error}
                    </AlertTitle>
                  </Alert>
                ) : null}
                {/* Botón normal y no `AlertDialogAction`: ese cierra el
                    diálogo al click y desmontaría el form antes de que la
                    acción devuelva el error del email mal escrito. */}
                <AlertDialogFooter className="mt-2">
                  <AlertDialogCancel variant="ghost">
                    {dict.common.cancel}
                  </AlertDialogCancel>
                  <Button
                    type="submit"
                    variant="destructive"
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
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        </CardAction>
      </CardHeader>
    </Card>
  )
}
