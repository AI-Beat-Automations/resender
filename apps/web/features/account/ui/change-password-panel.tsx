"use client"

import { useActionState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"
import { usePostHog } from "posthog-js/react"

import {
  changePasswordAction,
  type ChangePasswordState,
} from "@/features/account/actions"
import { CHANGE_PASSWORD_ANCHOR } from "@/features/account/ui/change-password-anchor"
import { SettingsCardHeader } from "@/features/settings/ui/settings-card"
import { useAppDict } from "@/content/i18n/app/provider"
import { isPostHogEnabled } from "@/lib/posthog-client"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardFooter } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

export function ChangePasswordPanel() {
  const posthog = usePostHog()
  const dict = useAppDict()
  const t = dict.account

  // El `reset()` va ANTES de la acción: en el camino feliz `changePasswordAction`
  // termina en `signOut`, que lanza un redirect, y ya no vuelve nada que
  // observar. Si la acción sí devuelve (solo pasa cuando la validación falla y la
  // sesión sigue viva) le devolvemos la identidad al navegador, para no dejar al
  // usuario logueado pero anónimo. No se usa `SignOutForm` aquí justo por eso.
  const [state, action, pending] = useActionState<
    ChangePasswordState,
    FormData
  >(async (previousState, formData) => {
    const previousDistinctId = isPostHogEnabled
      ? posthog.get_distinct_id()
      : undefined
    if (isPostHogEnabled) posthog.reset()

    const result = await changePasswordAction(previousState, formData)

    if (result.error && previousDistinctId) {
      posthog.identify(previousDistinctId)
    }
    return result
  }, {})

  return (
    // El id es el ancla del botón «Cambiar» de «Cómo entras a Resender».
    <Card id={CHANGE_PASSWORD_ANCHOR} className="scroll-mt-6">
      {/* El cierre de sesión se avisa antes, no después: `changePasswordAction`
          termina en `signOut({ redirectTo: "/login?passwordChanged=1" })`. */}
      <SettingsCardHeader
        title={t.passwordTitle}
        description={t.passwordBody}
      />
      <form action={action}>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="newPassword">{t.newPassword}</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder={t.newPasswordPlaceholder}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword">{t.confirmPassword}</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder={t.confirmPasswordPlaceholder}
              />
            </div>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            {t.passwordHint}
          </p>
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <TriangleAlert aria-hidden />
              <AlertTitle className="font-normal">{state.error}</AlertTitle>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="mt-4 justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className="animate-spin" aria-hidden />
                {dict.common.saving}
              </>
            ) : (
              t.passwordSubmit
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
