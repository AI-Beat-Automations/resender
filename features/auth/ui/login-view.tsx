import { redirect } from "next/navigation"
import { Check } from "lucide-react"

import { getSession } from "@/lib/auth/session"
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
import { GoogleSignIn } from "@/features/auth/ui/google-sign-in"
import { OauthErrorNotice } from "@/features/auth/ui/oauth-error-notice"
import { isGoogleEnabled } from "@/lib/auth/google"
import { classifyOAuthError } from "@/lib/auth/oauth-errors"
import { resolveProductAccess } from "@/lib/auth/waitlist"

// Vista de login compartida por `/login` (ES) y `/en/login` (EN). El diseño es
// el de la consola v2 (ADR 0005); el idioma sale del diccionario (ADR 0006).
export async function LoginView({
  lang,
  passwordChanged = false,
  oauthError,
}: {
  lang: Locale
  passwordChanged?: boolean
  /** El `?error=` crudo con el que Better Auth rebota desde el flujo de OAuth. */
  oauthError?: string
}) {
  // Solo rebota al producto quien de verdad puede entrar. Con `session != null`
  // alcanzaba mientras toda sesión firmada correspondiera a un usuario real;
  // una sesión huérfana (cookie de otra base, cuenta borrada) entraba acá, se
  // iba a `/connections`, el gate la devolvía y el navegador quedaba recargando
  // entre las dos rutas para siempre. Mostrar el formulario rompe el ciclo y
  // además lo arregla: autenticarse otra vez reemplaza la sesión inservible.
  const session = await getSession()
  if (
    session?.user?.id &&
    (await resolveProductAccess(session.user.id)) === "allowed"
  ) {
    redirect("/connections")
  }

  const t = getDictionary(lang).auth
  // Las dos decisiones de Google se toman acá, en el servidor: qué dice el
  // `?error=` (`lib/auth/oauth-errors`) y si el botón existe
  // (`isGoogleEnabled()`, para que la UI no lea `process.env`).
  const oauthErrorKind = classifyOAuthError(oauthError)
  const googleEnabled = isGoogleEnabled()

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
        {oauthErrorKind ? (
          <OauthErrorNotice kind={oauthErrorKind} lang={lang} />
        ) : null}
        {/* Google arriba, separador «o», y el formulario de siempre sin tocar.
            Sin credenciales no se dibuja ni el botón ni el separador. */}
        {googleEnabled ? <GoogleSignIn lang={lang} from="login" /> : null}
        <AuthForm action={loginAction} mode="login" lang={lang} />
      </AccessCard>
    </AccessShell>
  )
}
