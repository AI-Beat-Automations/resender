"use client"

import Link from "next/link"
import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import type { AuthFormState } from "@/features/auth/actions"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import { AuthNotice } from "@/features/auth/ui/auth-notice"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

type AuthAction = (
  state: AuthFormState,
  formData: FormData
) => Promise<AuthFormState>

type AuthFormProps = {
  action: AuthAction
  mode: "login" | "register"
  lang: Locale
}

// Solo el formulario: el «¿No tienes cuenta?» va fuera de la card
// (`AccessSwitchLink`), como en el mock `1b`.
export function AuthForm({ action, mode, lang }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {})
  const isLogin = mode === "login"
  const hasError = Boolean(state.error)
  const t = getDictionary(lang).auth.form
  const forgot = getDictionary(lang).auth.forgot

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* El server action no ve el pathname: le pasamos el idioma para que
          devuelva sus errores en el idioma de la página. */}
      <input type="hidden" name="locale" value={lang} />
      {/* Solo en el alta: Better Auth exige `name` al crear el usuario, y el
          acceso no lo pide. La regla de "no puede estar vacío" vive en
          `lib/auth/validation`, no acá: vitest no ejecuta `.tsx`. El
          `required` del input es la primera línea, no la única. */}
      {!isLogin && (
        <div className="grid gap-1.5">
          <Label htmlFor="name">{t.name}</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            disabled={pending}
            aria-invalid={hasError}
            placeholder={t.namePlaceholder}
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          aria-invalid={hasError}
          placeholder={t.emailPlaceholder}
        />
      </div>
      <div className="grid gap-1.5">
        {/* Único cambio de este formulario por la recuperación: la entrada al
            flujo, a la derecha de la etiqueta como en `1b`. `AuthForm` **no**
            gana un modo `forgot`/`reset` —esos dos tienen formularios
            propios— porque sumarle modos convierte el único formulario que
            autentica en el más difícil de auditar, y vitest no ejecuta
            `.tsx`. */}
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">{t.password}</Label>
          {isLogin && (
            <Link
              href={localePath("/forgot-password", lang)}
              className="text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {forgot.link}
            </Link>
          )}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          required
          minLength={8}
          disabled={pending}
          aria-invalid={hasError}
          aria-describedby={isLogin ? undefined : "password-hint"}
          placeholder={isLogin ? undefined : t.passwordPlaceholder}
        />
        {/* El mínimo de contraseña se anuncia antes de enviar, no como error
            del servidor: en el alta es un requisito, no un fallo. */}
        {!isLogin && (
          <p id="password-hint" className="text-[12.5px] text-muted-foreground">
            {t.passwordHint}
          </p>
        )}
      </div>
      {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {t.processing}
          </>
        ) : isLogin ? (
          t.signIn
        ) : (
          t.createAccount
        )}
      </Button>
    </form>
  )
}
