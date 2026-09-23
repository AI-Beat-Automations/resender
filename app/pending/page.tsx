import Link from "next/link"
import { redirect } from "next/navigation"
import { CircleCheck, MailCheck } from "lucide-react"

import { getSession, signOut } from "@/lib/auth/session"
import { PostHogIdentify } from "@/components/posthog-identify"
import { ResendVerificationForm } from "@/components/resend-verification-form"
import { SignOutForm } from "@/components/sign-out-form"
import { fmt } from "@/content/i18n/app"
import { resendVerificationEmailAction } from "@/features/auth/actions"
import {
  AccessCard,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { isEmailVerified } from "@/lib/auth/email-verified"
import { needsEmailVerification } from "@/lib/billing/free-plan-gate"
import { classifyVerificationError } from "@/lib/auth/oauth-errors"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { privatePageMetadata } from "@/lib/seo"
import { Button } from "@/components/ui/button"

// Estática y en español por el mismo motivo que en `/billing`: es el `<title>`
// de una página `noindex` y la metadata se resuelve fuera del render, sin
// acceso a la cookie de idioma.
export const metadata = privatePageMetadata("Lista de espera")

// Aterrizaje de las dos cuentas que no entran al producto: la que no confirmó
// su correo (gate del plan Free, ADR 0022) y la bloqueada por el gate de
// acceso. Desde la 0024
// ninguna cuenta nace en `waitlisted = true`, así que solo llega aquí una
// cuenta cerrada a mano por SQL (la 0019 la había vuelto default). Es la pantalla
// que la ADR 0007 había borrado, de vuelta en `/pending` porque `/waitlist` ya
// es la lista de espera pública de captación: aquella pide un correo que esta
// persona ya dio, así que mandarla ahí la dejaba pidiendo lo que ya tiene.
//
// Vive fuera del grupo `(product)` a propósito: ese layout rebota aquí a las
// cuentas en lista de espera o sin correo confirmado, así que esta página no puede ir envuelta por él.
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

  // [Verificacion de correo], leída **viva** y no de `session.user`: la cookie
  // de caché la trae vieja hasta cinco minutos, y quien acaba de confirmar
  // seguiría viendo «sin confirmar». `?error=` es lo que agrega
  // `GET /api/auth/verify-email` cuando el [Enlace de verificacion] no sirve;
  // solo «venció / no es válido» se dice, cualquier otro valor se ignora.
  const verified = await isEmailVerified(session.user.id)
  const linkExpired = classifyVerificationError(params.error) === "link_expired"

  // Cuenta aprobada: el único gate que le queda es el correo (ADR 0022). Con
  // el correo confirmado entra al producto en su plan; sin confirmar, esta
  // pantalla le pide solo eso, sin el mensaje de la lista de espera.
  if (
    access === "allowed" &&
    (verified || !(await needsEmailVerification(session.user.id)))
  ) {
    redirect("/connections")
  }
  const verifyGate = access === "allowed"

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/" })
  }

  const verifyBlock = (
    <>
      {linkExpired ? (
        <p
          role="alert"
          className="mt-2 text-[13px] text-destructive-soft-foreground"
        >
          {t.accessPending.verify.linkExpired}
        </p>
      ) : null}
      <ResendVerificationForm
        action={resendVerificationEmailAction}
        lang={lang}
        label={t.accessPending.verify.resend}
        sentLabel={t.accessPending.verify.sent}
        size="sm"
        className="mt-3"
      />
    </>
  )

  return (
    <AccessShell
      lang={lang}
      topbarEnd={
        // `SignOutForm` hace el `posthog.reset()` antes de la server action.
        <SignOutForm action={signOutAction}>
          <Button type="submit" variant="outline">
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
      {verifyGate ? (
        // Gate de correo del plan Free: la cuenta ya tiene plan, solo falta
        // confirmar el correo. El enlace del correo aterriza aquí mismo y la
        // redirección de arriba la manda al producto.
        <AccessCard className="max-w-130 p-7.5">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <MailCheck className="size-5" aria-hidden />
          </span>
          <AccessEyebrow label={t.accessPending.verifyGate.eyebrow} />
          <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
            {t.accessPending.verifyGate.title}
          </h1>
          <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
            {fmt(t.accessPending.verifyGate.body, {
              email: session.user.email,
            })}
          </p>
          {verifyBlock}
        </AccessCard>
      ) : (
        <AccessCard className="max-w-130 p-7.5">
          {/* Bloque de confirmación **por encima** del mensaje de aprobación y
            solo si el correo no está confirmado. En la lista de espera
            confirmar no da acceso: al aprobarla, el gate de correo del plan
            Free (arriba) es el que lo pide. */}
          {!verified ? (
            <div className="mb-6 rounded-lg border border-border bg-surface-sunken px-4 py-3.5">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <MailCheck className="size-4 shrink-0" aria-hidden />
                {t.accessPending.verify.title}
              </p>
              <p className="mt-1.5 text-[13px]/[1.6] text-muted-foreground">
                {fmt(t.accessPending.verify.body, {
                  email: session.user.email,
                })}
              </p>
              {verifyBlock}
            </div>
          ) : null}
          {/* Palomita sobre `primary-soft`, el mismo tratamiento que la espera de
            /billing/success: el registro SÍ terminó bien y la pantalla confirma
            eso primero. Un reloj o un candado leerían como error. */}
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <CircleCheck className="size-5" aria-hidden />
          </span>
          <AccessEyebrow label={t.accessPending.eyebrow} />
          <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
            {t.accessPending.title}
          </h1>
          <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
            {t.accessPending.body}
          </p>
          <div className="mt-4.5 rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
            <p className="text-[12.5px] text-muted-foreground">
              {t.accessPending.emailLabel}
            </p>
            <p className="mt-0.5 font-mono text-[13.5px]">
              {session.user.email}
            </p>
          </div>
          <p className="mt-4 text-[13px]/[1.6] text-muted-foreground">
            {t.accessPending.helpBefore}
            <Link
              href="/docs"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t.accessPending.helpDocsLink}
            </Link>
            {t.accessPending.helpMiddle}
            <a
              href={`mailto:${t.common.contactEmail}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t.common.contactEmail}
            </a>
            {t.accessPending.helpAfter}
          </p>
        </AccessCard>
      )}
    </AccessShell>
  )
}
