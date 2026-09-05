"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import { resetPasswordAction } from "@/features/auth/actions"
import { getDictionary, type Locale } from "@/content/i18n"
import { AuthNotice } from "@/features/auth/ui/auth-notice"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

export function ResetPasswordForm({
  lang,
  token,
}: {
  lang: Locale
  token: string
}) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, {})
  const t = getDictionary(lang).auth
  const hasError = Boolean(state.error)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={lang} />
      {/* El token viaja en el formulario y no se vuelve a leer del
          querystring: el server action no ve la URL de la página. */}
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-1.5">
        <Label htmlFor="password">{t.reset.password}</Label>
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
          placeholder={t.form.passwordPlaceholder}
        />
        <p id="password-hint" className="text-[12.5px] text-muted-foreground">
          {t.form.passwordHint}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirmPassword">{t.reset.confirmPassword}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={pending}
          aria-invalid={hasError}
        />
      </div>
      {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {t.form.processing}
          </>
        ) : (
          t.reset.submit
        )}
      </Button>
    </form>
  )
}
