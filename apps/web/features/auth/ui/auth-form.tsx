"use client"

import Link from "next/link"
import { useActionState } from "react"

import type { AuthFormState } from "@/features/auth/actions"
import { Button } from "@workspace/ui/components/button"

import { getDictionary, localePath, type Locale } from "@/content/i18n"

type AuthAction = (
  state: AuthFormState,
  formData: FormData
) => Promise<AuthFormState>

type AuthFormProps = {
  action: AuthAction
  mode: "login" | "register"
  lang: Locale
}

export function AuthForm({ action, mode, lang }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {})
  const isLogin = mode === "login"
  const t = getDictionary(lang).auth.form

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* El server action no ve el pathname: le pasamos el idioma para que
          devuelva los mensajes de error en el idioma de la página. */}
      <input type="hidden" name="locale" value={lang} />
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="email">
          {t.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          placeholder={t.emailPlaceholder}
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="password">
          {t.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          required
          minLength={8}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          placeholder={t.passwordPlaceholder}
        />
      </div>
      {state.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t.processing : isLogin ? t.signIn : t.createAccount}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? t.noAccount : t.haveAccount}{" "}
        <Link
          href={localePath(isLogin ? "/register" : "/login", lang)}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {isLogin ? t.signUp : t.signInAction}
        </Link>
      </p>
    </form>
  )
}
