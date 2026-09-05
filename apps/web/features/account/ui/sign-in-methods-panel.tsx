import type { ReactNode } from "react"
import { TriangleAlert } from "lucide-react"

import { ResendVerificationForm } from "@/components/resend-verification-form"
import type { Locale } from "@/content/i18n"
import type { AppDict } from "@/content/i18n/app"
import { CHANGE_PASSWORD_ANCHOR } from "@/features/account/ui/change-password-anchor"
import { LinkGoogleForm } from "@/features/account/ui/link-google-form"
import { UnlinkGoogleForm } from "@/features/account/ui/unlink-google-form"
import { SettingsCardHeader } from "@/features/settings/ui/settings-card"
import { classifyOAuthError } from "@/lib/auth/oauth-errors"
import type { SignInMethods } from "@/lib/auth/sign-in-methods"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"

// El estado de `resendVerificationEmailAction`, estructural: `features/account`
// no importa de `features/auth`. La acción llega por prop desde la página,
// que es la capa que compone (igual que `SignOutForm`).
type ResendState = { error?: string; sent?: boolean }
type ResendAction = (
  state: ResendState,
  formData: FormData
) => Promise<ResendState>

// Panel «Cómo entras a Resender» ([Cuenta vinculada], issue #98; mock 1j).
// Arriba de las credenciales, el estado del correo —solo si no está
// confirmado—; debajo, una fila por [Credencial] con `Badge` de estado y el
// botón `outline` a la derecha. La fila de Google se dibuja solo con
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
    <Card>
      <SettingsCardHeader title={copy.title} description={copy.body} />
      <CardContent className="flex flex-col gap-3">
        {oauthErrorKind ? (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden />
            <AlertTitle className="font-normal">
              {oauthErrorKind === "account_not_linked"
                ? t.actions.oauthAccountNotLinked
                : t.actions.linkFailed}
            </AlertTitle>
          </Alert>
        ) : null}
        {!verified ? (
          <Alert variant="warning" role="status">
            <TriangleAlert aria-hidden />
            <AlertTitle>{copy.emailUnverified}</AlertTitle>
            <AlertDescription className="text-[12.5px]">
              {copy.emailUnverifiedHint}
            </AlertDescription>
            <ResendVerificationForm
              action={resendAction}
              lang={lang}
              label={copy.resend}
              sentLabel={copy.resendSent}
              size="sm"
              className="col-start-2 mt-1.5"
            />
          </Alert>
        ) : null}

        <div className="divide-y divide-border">
          <MethodRow
            name={copy.password}
            status={
              methods.password ? (
                <Badge variant="success">{copy.passwordConfigured}</Badge>
              ) : (
                <Badge variant="outline">{copy.passwordMissing}</Badge>
              )
            }
            action={
              <Button asChild variant="outline" size="sm">
                <a href={`#${CHANGE_PASSWORD_ANCHOR}`}>{copy.change}</a>
              </Button>
            }
          />
          {googleEnabled ? (
            <MethodRow
              name={copy.google}
              status={
                methods.google.linked ? (
                  <>
                    <Badge variant="success">{copy.linked}</Badge>
                    {/* «La dirección de Google» es el email de la cuenta:
                        vincular exige que coincidan, y `listUserAccounts` no
                        trae el de Google (solo el `sub`). */}
                    <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                      {email}
                    </span>
                  </>
                ) : (
                  <Badge variant="outline">{copy.googleNotLinked}</Badge>
                )
              }
              action={
                methods.google.linked ? (
                  methods.canRemoveGoogle && methods.google.accountId ? (
                    <UnlinkGoogleForm accountId={methods.google.accountId} />
                  ) : (
                    // Sin contraseña, Google es la única forma de entrar: no
                    // se ofrece quitarla, se explica por qué.
                    <span className="text-[12.5px] text-muted-foreground">
                      {copy.lastCredentialHint}
                    </span>
                  )
                ) : (
                  <LinkGoogleForm verified={verified} />
                )
              }
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

// Una credencial por fila: nombre y estado a la izquierda, acción a la
// derecha. Los forms de Google traen su propio error/hint y por eso la acción
// puede crecer a lo ancho: `flex-wrap` en vez de un ancho fijo.
function MethodRow({
  name,
  status,
  action,
}: {
  name: string
  status: ReactNode
  action: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13.5px] font-medium">{name}</span>
        <span className="flex min-w-0 items-center gap-2">{status}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {action}
      </div>
    </div>
  )
}
