import { redirect } from "next/navigation"
import { Check } from "lucide-react"

import { auth } from "@/auth"
import { HtmlLang } from "@/components/html-lang"
import { getDictionary, type Locale } from "@/content/i18n"
import { loginAction } from "@/features/auth/actions"
import {
  AccessCard,
  AccessDocsLink,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { AuthForm } from "@/features/auth/ui/auth-form"

// Vista de login compartida por `/login` (ES) y `/en/login` (EN). El diseño es
// el de la consola v2 (ADR 0005); el idioma sale del diccionario (ADR 0006).
export async function LoginView({
  lang,
  passwordChanged = false,
}: {
  lang: Locale
  passwordChanged?: boolean
}) {
  const session = await auth()
  if (session?.user?.id) redirect("/connections")

  const t = getDictionary(lang).auth

  return (
    <AccessShell lang={lang} topbarEnd={<AccessDocsLink lang={lang} />}>
      <HtmlLang lang={lang} />
      <AccessCard className="max-w-100">
        <AccessEyebrow label={t.login.eyebrow} />
        <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
          {t.login.title}.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t.login.subtitle}</p>
        {passwordChanged ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-success-soft-border bg-success-soft px-3 py-2.5 text-[13px] text-success-soft-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t.passwordChanged}
          </p>
        ) : null}
        <AuthForm action={loginAction} mode="login" lang={lang} />
      </AccessCard>
    </AccessShell>
  )
}
