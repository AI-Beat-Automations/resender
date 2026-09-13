import { redirect } from "next/navigation"
import { Building2 } from "lucide-react"

import { resolveActor } from "@/lib/auth/actor"
import { getSession, signOut } from "@/lib/auth/session"
import { PostHogIdentify } from "@/components/posthog-identify"
import { SignOutForm } from "@/components/sign-out-form"
import {
  AccessCard,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { privatePageMetadata } from "@/lib/seo"
import { Button } from "@/components/ui/button"

// Estática y en español por el mismo motivo que en `/billing`: es el `<title>`
// de una página `noindex` y la metadata se resuelve fuera del render.
export const metadata = privatePageMetadata("Acceso de tu agencia")

// Aterrizaje de la persona de un cliente de agencia cuando su agencia no tiene
// acceso activo (ADR 0020): la agencia no paga, se le cerró el gate a mano, o
// el cliente dejó de existir a mitad de sesión. Es el `/billing` de quien no
// paga: no puede resolverlo solo, así que no se le muestran precios.
//
// Vive fuera de `(product)` por lo mismo que `/pending` y `/billing`: ese
// layout rebota aquí, así que no puede envolverla. El motivo se resuelve vivo
// en cada request y nunca de un query param: cualquiera que no tenga que estar
// aquí se va a su lugar.
export default async function AccessPage() {
  const [{ lang, t }, session] = await Promise.all([getAppI18n(), getSession()])
  if (!session?.user?.id) redirect("/login")

  const resolution = await resolveActor(session.user.id)
  if (resolution.status === "unknown_user") redirect("/login")
  if (resolution.status === "waitlisted") redirect("/pending")
  if (resolution.status === "ok") {
    const paying = await hasActiveSubscription(resolution.actor.tenantId)
    if (paying) redirect("/connections")
    // El dueño sin suscripción sí puede resolverlo: va a pagar.
    if (resolution.actor.kind === "owner") redirect("/billing")
  }

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
            {t.accessAgency.signOut}
          </Button>
        </SignOutForm>
      }
    >
      {/* Fuera de `(product)`: no hereda su identify. */}
      <PostHogIdentify
        distinctId={session.user.id}
        email={session.user.email}
      />
      <AccessCard className="max-w-130 p-7.5">
        <span className="flex size-11 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground">
          <Building2 className="size-5" aria-hidden />
        </span>
        <AccessEyebrow label={t.accessAgency.eyebrow} />
        <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
          {t.accessAgency.title}
        </h1>
        <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
          {t.accessAgency.body}
        </p>
        <div className="mt-4.5 rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
          <p className="text-[12.5px] text-muted-foreground">
            {t.accessAgency.emailLabel}
          </p>
          <p className="mt-0.5 font-mono text-[13.5px]">{session.user.email}</p>
        </div>
      </AccessCard>
    </AccessShell>
  )
}
