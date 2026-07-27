import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { SiteFooter } from "@/components/site-footer"
import { HtmlLang } from "@/components/html-lang"
import { registerAction } from "@/features/auth/actions"
import { AuthForm } from "@/features/auth/ui/auth-form"
import { getDictionary, type Locale } from "@/content/i18n"

// Vista de registro compartida por `/register` (ES) y `/en/register` (EN).
export async function RegisterView({ lang }: { lang: Locale }) {
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
              {dict.auth.register.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {dict.auth.register.subtitle}
            </p>
          </div>
          <AuthForm action={registerAction} mode="register" lang={lang} />
        </div>
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
