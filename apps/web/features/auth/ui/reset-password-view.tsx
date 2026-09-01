import Link from "next/link"

import { peekResetToken } from "@/lib/auth/password-reset"
import { HtmlLang } from "@/components/html-lang"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import {
  AccessCard,
  AccessDocsLink,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { ResetPasswordForm } from "@/features/auth/ui/reset-password-form"
import { Button } from "@workspace/ui/components/button"

// Vista compartida por `/reset-password` (ES) y `/en/reset-password` (EN).
//
// El `peek` sobre el token va **antes** de dibujar el formulario: darle la mala
// noticia a la persona después de que pensó y tipeó dos contraseñas es
// exactamente lo que esta pantalla existe para evitar. No consume el token —lo
// consume `resetPasswordAction`— y el TOCTOU entre las dos es benigno.
export async function ResetPasswordView({
  lang,
  token,
}: {
  lang: Locale
  token: string
}) {
  const t = getDictionary(lang).auth
  const alive = token ? await peekResetToken(token) : false

  return (
    <AccessShell lang={lang} topbarEnd={<AccessDocsLink lang={lang} />}>
      <HtmlLang lang={lang} />
      <AccessCard className="max-w-100">
        <AccessEyebrow label={t.reset.eyebrow} />
        {alive ? (
          <>
            <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
              {t.reset.title}.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.reset.subtitle}
            </p>
            <ResetPasswordForm lang={lang} token={token} />
          </>
        ) : (
          <>
            <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
              {t.reset.expiredTitle}.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.reset.expiredBody}
            </p>
            <Button asChild size="lg" className="mt-5 w-full">
              <Link href={localePath("/forgot-password", lang)}>
                {t.reset.requestAnother}
              </Link>
            </Button>
          </>
        )}
      </AccessCard>
    </AccessShell>
  )
}
