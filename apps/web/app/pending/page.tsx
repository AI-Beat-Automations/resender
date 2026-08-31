import Link from "next/link"
import { redirect } from "next/navigation"
import { CircleCheck } from "lucide-react"

import { auth, signOut } from "@/auth"
import { PostHogIdentify } from "@/components/posthog-identify"
import { SignOutForm } from "@/components/sign-out-form"
import {
  AccessCard,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { privatePageMetadata } from "@/lib/seo"
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
export default async function PendingPage() {
  const { lang, t } = await getAppI18n()
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  // Las tres respuestas del gate, cada una a su salida. `unknown_user` no cae
  // aquí: una sesión firmada contra un usuario inexistente solo se arregla
  // volviendo a autenticarse, y tratarla como "en espera" era justo el rebote
  // infinito que documenta `lib/auth/waitlist.ts`.
  const access = await resolveProductAccess(session.user.id)
  if (access === "unknown_user") redirect("/login")
  if (access === "allowed") redirect("/connections")

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
      <AccessCard className="max-w-130 p-7.5">
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
          <p className="mt-0.5 font-mono text-[13.5px]">{session.user.email}</p>
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
    </AccessShell>
  )
}
