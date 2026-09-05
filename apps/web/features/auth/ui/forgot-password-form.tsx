"use client"

import Link from "next/link"
import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import { forgotPasswordAction } from "@/features/auth/actions"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import { AuthNotice } from "@/features/auth/ui/auth-notice"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

// Formulario propio y **no** un modo más de `AuthForm`: sumarle dos modos
// llenaría de condiciones cruzadas el único formulario que autentica del
// producto, y vitest no ejecuta `.tsx`, así que ese refactor no tendría red.
// Lo que sí se comparte es el chrome (`AccessShell`/`AccessCard`) y el bloque
// de error (`AuthNotice`).
export function ForgotPasswordForm({ lang }: { lang: Locale }) {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, {})
  const t = getDictionary(lang).auth

  // "Revisá tu buzón" vive **dentro de la card**, no en una ruta propia: una
  // URL pública sin estado la podría abrir cualquiera sin haber pedido nada, y
  // el botón de reenviar necesita el email que se acaba de tipear.
  if (state.sent) {
    return (
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="locale" value={lang} />
        <AuthNotice tone="success" role="status" title={t.forgot.sentTitle}>
          {t.forgot.sentBody}
        </AuthNotice>
        <div className="grid gap-1.5">
          <Label htmlFor="email">{t.form.email}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={pending}
            placeholder={t.form.emailPlaceholder}
          />
        </div>
        {/* Reenviar consume un intento del rate limit que comparte con el
            login (10/60s por IP). Está aceptado: quien reenvía dos veces
            todavía tiene ocho intentos. */}
        <Button
          type="submit"
          size="lg"
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
            t.forgot.resend
          )}
        </Button>
        <BackToLogin lang={lang} label={t.forgot.backToLogin} />
      </form>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* El server action no ve el pathname: el idioma va en un input oculto,
          igual que en `AuthForm`. */}
      <input type="hidden" name="locale" value={lang} />
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t.form.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          aria-invalid={Boolean(state.error)}
          placeholder={t.form.emailPlaceholder}
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
          t.forgot.submit
        )}
      </Button>
      <BackToLogin lang={lang} label={t.forgot.backToLogin} />
    </form>
  )
}

function BackToLogin({ lang, label }: { lang: Locale; label: string }) {
  return (
    <p className="text-center text-[13.5px] text-muted-foreground">
      <Link
        href={localePath("/login", lang)}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {label}
      </Link>
    </p>
  )
}
