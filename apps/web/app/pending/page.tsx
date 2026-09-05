import Link from "next/link"
import { redirect } from "next/navigation"
import { CircleCheck, MailCheck } from "lucide-react"

import { getSession, signOut } from "@/lib/auth/session"
import { PostHogIdentify } from "@/components/posthog-identify"
import { ResendVerificationForm } from "@/components/resend-verification-form"
import { SignOutForm } from "@/components/sign-out-form"
import { fmt } from "@/content/i18n/app"
import { resendVerificationEmailAction } from "@/features/auth/actions"
import { AccessCard, AccessShell } from "@/features/auth/ui/access-shell"
import { isEmailVerified } from "@/lib/auth/email-verified"
import { classifyVerificationError } from "@/lib/auth/oauth-errors"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { privatePageMetadata } from "@/lib/seo"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

// Estática y en español por el mismo motivo que en `/billing`: es el `<title>`
// de una página `noindex` y la metadata se resuelve fuera del render, sin
// acceso a la cookie de idioma.
export const metadata = privatePageMetadata("Lista de espera")

// Aterrizaje de la cuenta que acaba de registrarse con el gate encendido
// (migración 0019: `users.waitlisted` vuelve a nacer en `true`). Es la pantalla
// que la ADR 0007 había borrado, de vuelta en `/pending` porque `/waitlist` ya
// es la lista de espera pública de captación: aquella pide un correo que esta
// persona ya dio, así que mandarla ahí la dejaba pidiendo lo que ya tiene.
//
// Vive fuera del grupo `(product)` a propósito: ese layout rebota aquí a las
// cuentas en lista de espera, así que esta página no puede ir envuelta por él.
type PendingPageProps = {
  searchParams: Promise<{ error?: string }>
}

export default async function PendingPage({ searchParams }: PendingPageProps) {
  const [{ lang, t }, session, params] = await Promise.all([
    getAppI18n(),
    getSession(),
    searchParams,
  ])
  if (!session?.user?.id) redirect("/login")

  // Las tres respuestas del gate, cada una a su salida. `unknown_user` no cae
  // aquí: una sesión firmada contra un usuario inexistente solo se arregla
  // volviendo a autenticarse, y tratarla como "en espera" era justo el rebote
  // infinito que documenta `lib/auth/waitlist.ts`.
  const access = await resolveProductAccess(session.user.id)
  if (access === "unknown_user") redirect("/login")
  if (access === "allowed") redirect("/connections")

  // [Verificacion de correo], leída **viva** y no de `session.user`: la cookie
  // de caché la trae vieja hasta cinco minutos, y quien acaba de confirmar
  // seguiría viendo «sin confirmar». `?error=` es lo que agrega
  // `GET /api/auth/verify-email` cuando el [Enlace de verificacion] no sirve;
  // solo «venció / no es válido» se dice, cualquier otro valor se ignora.
  const verified = await isEmailVerified(session.user.id)
  const linkExpired = classifyVerificationError(params.error) === "link_expired"

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/" })
  }

  return (
    <AccessShell
      lang={lang}
      topbarEnd={
        // `SignOutForm` hace el `posthog.reset()` antes de la server action.
        <SignOutForm action={signOutAction}>
          <Button type="submit" variant="ghost">
            {t.accessPending.signOut}
          </Button>
        </SignOutForm>
      }
    >
      {/* Esta página está fuera de `(product)`, así que no hereda su identify.
          Renderiza null, así que no toca el layout del `main`. */}
      <PostHogIdentify
        distinctId={session.user.id}
        email={session.user.email}
      />
      <AccessCard
        className="max-w-130"
        align="start"
        eyebrow={t.accessPending.eyebrow}
        title={t.accessPending.title}
        description={t.accessPending.body}
        header={
          <>
            {/* Bloque de confirmación **por encima** del mensaje de aprobación
                y solo si el correo no está confirmado. Confirmar no da acceso
                y no confirmar no lo quita: lo único que habilita es vincular
                Google. Una cuenta aprobada no llega a leer esto —`/pending`
                la rebota—, así que confirma y reenvía desde Settings. */}
            {!verified ? (
              <Alert role="note" className="mb-4 bg-surface-sunken">
                <MailCheck aria-hidden />
                <AlertTitle>{t.accessPending.verify.title}</AlertTitle>
                <AlertDescription className="flex flex-col gap-2.5 text-[13px]/[1.6] [&_p:not(:last-child)]:mb-0">
                  <p>
                    {fmt(t.accessPending.verify.body, {
                      email: session.user.email,
                    })}
                  </p>
                  {linkExpired ? (
                    <p
                      role="alert"
                      className="text-destructive-soft-foreground"
                    >
                      {t.accessPending.verify.linkExpired}
                    </p>
                  ) : null}
                  <ResendVerificationForm
                    action={resendVerificationEmailAction}
                    lang={lang}
                    label={t.accessPending.verify.resend}
                    sentLabel={t.accessPending.verify.sent}
                    variant="outline"
                    size="sm"
                  />
                </AlertDescription>
              </Alert>
            ) : null}
            {/* Palomita en `text-success`, el mismo tratamiento que
                /billing/success: el registro SÍ terminó bien y la pantalla
                confirma eso primero. Un reloj o un candado leerían como
                error. */}
            <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-success-soft text-success">
              <CircleCheck className="size-5" aria-hidden />
            </span>
          </>
        }
      >
        <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
          <p className="text-[12.5px] text-muted-foreground">
            {t.accessPending.emailLabel}
          </p>
          <p className="mt-0.5 font-mono text-[13.5px]">{session.user.email}</p>
        </div>
        <p className="text-[13px]/[1.6] text-muted-foreground">
          {t.accessPending.helpBefore}
          <Link
            href="/docs"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t.accessPending.helpDocsLink}
          </Link>
          {t.accessPending.helpMiddle}
          <a
            href={`mailto:${t.common.contactEmail}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t.common.contactEmail}
          </a>
          {t.accessPending.helpAfter}
        </p>
      </AccessCard>
    </AccessShell>
  )
}
