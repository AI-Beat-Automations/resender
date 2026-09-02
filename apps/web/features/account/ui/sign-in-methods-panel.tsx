import { TriangleAlert } from "lucide-react"

import { ResendVerificationForm } from "@/components/resend-verification-form"
import type { Locale } from "@/content/i18n"
import type { AppDict } from "@/content/i18n/app"
import { LinkGoogleForm } from "@/features/account/ui/link-google-form"
import { UnlinkGoogleForm } from "@/features/account/ui/unlink-google-form"
import {
  SettingsCard,
  SettingsCardTitle,
  SettingsDataRow,
} from "@/features/settings/ui/settings-card"
import { classifyOAuthError } from "@/lib/auth/oauth-errors"
import type { SignInMethods } from "@/lib/auth/sign-in-methods"

// El estado de `resendVerificationEmailAction`, estructural: `features/account`
// no importa de `features/auth`. La acción llega por prop desde la página,
// que es la capa que compone (igual que `SignOutForm`).
type ResendState = { error?: string; sent?: boolean }
type ResendAction = (
  state: ResendState,
  formData: FormData
) => Promise<ResendState>

// Panel «Cómo entras a Resender» ([Cuenta vinculada], issue #98). Arriba de
// las credenciales, el estado del correo —solo si no está confirmado—; debajo,
// una fila por [Credencial]. La fila de Google se dibuja solo con
// `googleEnabled`; la del correo y la de la contraseña valen igual sin Google.
//
// Es la pantalla donde una cuenta **aprobada** confirma su correo: `/pending`
// la rebota a `/connections` antes de mostrarle nada.
export function SignInMethodsPanel({
  email,
  verified,
  methods,
  googleEnabled,
  lang,
  t,
  resendAction,
  oauthError,
}: {
  email: string
  /** `isEmailVerified()`, leído vivo, nunca de la sesión. */
  verified: boolean
  methods: SignInMethods
  /** `isGoogleEnabled()`, resuelto en la página: la UI no lee `process.env`. */
  googleEnabled: boolean
  lang: Locale
  t: AppDict
  resendAction: ResendAction
  /** El `?error=` con el que Better Auth rebota a `errorCallbackURL`. */
  oauthError?: string
}) {
  const copy = t.account.signInMethods
  // Solo dos mensajes: `account_not_linked` (el correo no estaba confirmado
  // cuando volvió de Google, o el de Google no coincide) y el genérico.
  const oauthErrorKind = classifyOAuthError(oauthError)

  return (
    <SettingsCard>
      <SettingsCardTitle>{copy.title}</SettingsCardTitle>
      <p className="mt-1 max-w-140 text-[13.5px]/[1.55] text-muted-foreground">
        {copy.body}
      </p>
      {oauthErrorKind ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-soft-foreground"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {oauthErrorKind === "account_not_linked"
            ? t.actions.oauthAccountNotLinked
            : t.actions.linkFailed}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2.5">
        {!verified ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning-soft-border bg-warning-soft px-3.5 py-3">
            <p className="text-[13.5px] font-medium">{copy.emailUnverified}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {copy.emailUnverifiedHint}
            </p>
            <ResendVerificationForm
              action={resendAction}
              lang={lang}
              label={copy.resend}
              sentLabel={copy.resendSent}
              size="sm"
            />
          </div>
        ) : null}
        <SettingsDataRow label={copy.password}>
          <span className="min-w-0 truncate text-[13.5px]">
            {methods.password ? copy.passwordConfigured : copy.passwordMissing}
          </span>
        </SettingsDataRow>
        {googleEnabled ? (
          <SettingsDataRow label={copy.google}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {methods.google.linked ? (
                <>
                  {/* «La dirección de Google» es el email de la cuenta:
                      vincular exige que coincidan, y `listUserAccounts` no
                      trae el de Google (solo el `sub`). */}
                  <span className="min-w-0 truncate text-[13.5px]">
                    {copy.linked}
                    <span className="text-muted-foreground"> · {email}</span>
                  </span>
                  {methods.canRemoveGoogle && methods.google.accountId ? (
                    <UnlinkGoogleForm accountId={methods.google.accountId} />
                  ) : (
                    // Sin contraseña, Google es la única forma de entrar: no se
                    // ofrece quitarla, se explica por qué.
                    <span className="text-[12.5px] text-muted-foreground">
                      {copy.lastCredentialHint}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="min-w-0 truncate text-[13.5px]">
                    {copy.googleNotLinked}
                  </span>
                  <LinkGoogleForm verified={verified} />
                </>
              )}
            </div>
          </SettingsDataRow>
        ) : null}
      </div>
    </SettingsCard>
  )
}
