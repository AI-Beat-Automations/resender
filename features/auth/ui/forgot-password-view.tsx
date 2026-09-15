import { HtmlLang } from "@/components/html-lang"
import { getDictionary, type Locale } from "@/content/i18n"
import {
  AccessCard,
  AccessDocsLink,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { ForgotPasswordForm } from "@/features/auth/ui/forgot-password-form"

// Vista compartida por `/forgot-password` (ES) y `/en/forgot-password` (EN).
// El slug va en inglés y sin traducir, como `/login`, `/register` y `/waitlist`.
//
// A diferencia de login y registro **no rebota a la sesión abierta**: quien
// tiene sesión y aterriza acá probablemente llegó desde el correo en otro
// dispositivo, y mandarlo a `/connections` le sacaría la pantalla de encima.
export function ForgotPasswordView({ lang }: { lang: Locale }) {
  const t = getDictionary(lang).auth

  return (
    <AccessShell lang={lang} topbarEnd={<AccessDocsLink lang={lang} />}>
      <HtmlLang lang={lang} />
      <AccessCard className="max-w-100">
        <AccessEyebrow label={t.forgot.eyebrow} />
        <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
          {t.forgot.title}.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.forgot.subtitle}
        </p>
        <ForgotPasswordForm lang={lang} />
      </AccessCard>
    </AccessShell>
  )
}
