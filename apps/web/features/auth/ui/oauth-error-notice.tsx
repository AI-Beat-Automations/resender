"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import { resendVerificationEmailAction } from "@/features/auth/actions"
import { getDictionary, type Locale } from "@/content/i18n"
import { AuthNotice } from "@/features/auth/ui/auth-notice"
import type { OAuthErrorKind } from "@/lib/auth/oauth-errors"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

// El `?error=` con el que Better Auth rebota a `/login` o `/register` desde el
// flujo de OAuth, ya clasificado por `lib/auth/oauth-errors.ts` en el server
// component que lo dibuja. **No hay ruta de error**: el mensaje va en el mismo
// cuadro `role="alert"` que usa `auth-form`, dentro de la card.
//
// Solo `account_not_linked` tiene salida propia: la cuenta existe con
// contraseña y su correo no está confirmado, así que la librería no vinculó
// (`requireLocalEmailVerified`) y **no mandó nada**. El botón de acá es lo que
// manda la confirmación. Sin sesión, pide el correo; la respuesta es idéntica
// exista la cuenta o no.
export function OauthErrorNotice({
  kind,
  lang,
}: {
  kind: OAuthErrorKind
  lang: Locale
}) {
  const t = getDictionary(lang).auth

  return (
    <div className="flex flex-col gap-3">
      <AuthNotice tone="error">
        {kind === "account_not_linked"
          ? t.oauthErrors.accountNotLinked
          : t.oauthErrors.generic}
      </AuthNotice>
      {kind === "account_not_linked" ? <ResendForm lang={lang} /> : null}
    </div>
  )
}

function ResendForm({ lang }: { lang: Locale }) {
  const [state, formAction, pending] = useActionState(
    resendVerificationEmailAction,
    {}
  )
  const t = getDictionary(lang).auth

  // En condicional y sin nombrar el correo (`resendSent`): la pantalla no
  // revela si una cuenta existe, igual que `forgot.sentBody`.
  if (state.sent) {
    return (
      <AuthNotice tone="success" role="status">
        {t.oauthErrors.resendSent}
      </AuthNotice>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="locale" value={lang} />
      <Input
        name="email"
        type="email"
        autoComplete="email"
        required
        disabled={pending}
        aria-label={t.form.email}
        placeholder={t.oauthErrors.resendEmailPlaceholder}
      />
      {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      {/* Reenviar consume un intento del rate limit que comparte con el login
          (10/60s por IP), igual que el reenvío de la recuperación. */}
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={pending}
      >
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {t.form.processing}
          </>
        ) : (
          t.oauthErrors.resendCta
        )}
      </Button>
    </form>
  )
}
