import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { HtmlLang } from "@/components/html-lang"
import { getDictionary, type Locale } from "@/content/i18n"
import { registerAction } from "@/features/auth/actions"
import {
  AccessCard,
  AccessDocsLink,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { AuthForm } from "@/features/auth/ui/auth-form"
import { resolveProductAccess } from "@/lib/auth/waitlist"

// Vista de registro compartida por `/register` (ES) y `/en/register` (EN). El
// diseño es el de la consola v2 (ADR 0005); el idioma, del diccionario (0006).
export async function RegisterView({ lang }: { lang: Locale }) {
  // Mismo criterio que `login-view`: rebota solo la sesión que puede entrar al
  // producto, para que una sesión huérfana no rebote contra el gate.
  const session = await auth()
  if (
    session?.user?.id &&
    (await resolveProductAccess(session.user.id)) === "allowed"
  ) {
    redirect("/connections")
  }

  const t = getDictionary(lang).auth

  return (
    <AccessShell lang={lang} topbarEnd={<AccessDocsLink lang={lang} />}>
      <HtmlLang lang={lang} />
      <AccessCard className="max-w-95 p-6.5">
        <AccessEyebrow label={t.register.eyebrow} />
        <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
          {t.register.title}.
        </h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          {t.register.subtitle}
        </p>
        <AuthForm action={registerAction} mode="register" lang={lang} />
      </AccessCard>
    </AccessShell>
  )
}
