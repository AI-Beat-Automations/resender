"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"
import { usePostHog } from "posthog-js/react"

import {
  changePasswordAction,
  type ChangePasswordState,
} from "@/features/account/actions"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import { useAppDict } from "@/content/i18n/app/provider"
import { isPostHogEnabled } from "@/lib/posthog-client"
import { Button } from "@workspace/ui/components/button"
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
    <SettingsCard>
      <SettingsCardTitle>{t.passwordTitle}</SettingsCardTitle>
      {/* El cierre de sesión se avisa antes, no después: `changePasswordAction`
          termina en `signOut({ redirectTo: "/login?passwordChanged=1" })`. */}
      <p className="mt-1 max-w-140 text-[13.5px]/[1.55] text-muted-foreground">
        {t.passwordBody}
      </p>
      <form action={action} className="mt-4 max-w-140">
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
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {t.passwordHint}
        </p>
        <Button type="submit" size="lg" className="mt-4" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              {dict.common.saving}
            </>
          ) : (
            t.passwordSubmit
          )}
        </Button>
        {state.error ? (
          <p className="mt-3 text-[13px] text-destructive">{state.error}</p>
        ) : null}
      </form>
    </SettingsCard>
  )
}
