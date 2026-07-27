import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { SiteFooter } from "@/components/site-footer"
import { HtmlLang } from "@/components/html-lang"
import { loginAction } from "@/features/auth/actions"
import { AuthForm } from "@/features/auth/ui/auth-form"
import { getDictionary, type Locale } from "@/content/i18n"

// Vista de login compartida por `/login` (ES) y `/en/login` (EN).
export async function LoginView({
  lang,
  passwordChanged = false,
}: {
  lang: Locale
  passwordChanged?: boolean
}) {
  const session = await auth()
  if (session?.user?.id) redirect("/connections")

  const dict = getDictionary(lang)

  return (
    <div className="flex min-h-svh flex-col">
      <HtmlLang lang={lang} />
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">
              {dict.auth.login.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {dict.auth.login.subtitle}
            </p>
          </div>
          {passwordChanged ? (
            <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-100">
              {dict.auth.passwordChanged}
            </p>
          ) : null}
          <AuthForm action={loginAction} mode="login" lang={lang} />
        </div>
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
