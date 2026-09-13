import Link from "next/link"
import { redirect } from "next/navigation"
import { Link2Off, UserPlus } from "lucide-react"

import { getSession, signOut } from "@/lib/auth/session"
import { SignOutForm } from "@/components/sign-out-form"
import { fmt } from "@/content/i18n/app"
import { localePath } from "@/content/i18n"
import { AcceptInviteForm } from "@/features/client-invite/ui/accept-invite-form"
import {
  AccessCard,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import {
  diagnoseInvitationEligibility,
  findInvitationPreview,
  findMembershipByInvitation,
} from "@/lib/clients/client-repository"
import {
  hashInviteToken,
  invitePath,
  isInviteToken,
} from "@/lib/clients/invite-token"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { privatePageMetadata } from "@/lib/seo"
import { Button } from "@/components/ui/button"

// Estática y en español por el mismo motivo que en `/billing`.
export const metadata = {
  ...privatePageMetadata("Invitación"),
  // El token viaja en la query: que no salga en el `Referer` de ningún enlace
  // de esta pantalla.
  referrer: "no-referrer" as const,
}

type InvitePageProps = {
  searchParams: Promise<{ token?: string | string[] }>
}

// Aterrizaje del [Enlace de invitación] de un cliente de agencia (ADR 0020).
// Todo se resuelve vivo en cada request: el enlace puede haber vencido, haberse
// usado o haber sido reemplazado entre que se generó y se abrió.
//
// La pantalla solo explica y ofrece el botón. Lo que decide es la acción de
// aceptar, que vuelve a comprobar todo en una sola sentencia.
export default async function InvitePage({ searchParams }: InvitePageProps) {
  const [{ lang, t }, session, params] = await Promise.all([
    getAppI18n(),
    getSession(),
    searchParams,
  ])
  const raw = Array.isArray(params.token) ? params.token[0] : params.token
  const token = isInviteToken(raw) ? raw : null
  const tokenHash = token ? hashInviteToken(token) : null
  const signedIn = session?.user?.id ? session.user : null

  // Quien ya aceptó este enlace y vuelve a abrirlo va directo al producto.
  if (signedIn && tokenHash) {
    if (await findMembershipByInvitation(signedIn.id, tokenHash)) {
      redirect("/connections")
    }
  }

  const preview = tokenHash ? await findInvitationPreview(tokenHash) : null

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: token ? invitePath(token) : "/" })
  }

  const signOutButton = signedIn ? (
    <SignOutForm action={signOutAction}>
      <Button type="submit" variant="outline">
        {t.invite.signOut}
      </Button>
    </SignOutForm>
  ) : null

  if (!token || !preview) {
    return (
      <AccessShell lang={lang} topbarEnd={signOutButton}>
        <AccessCard className="max-w-130 p-7.5">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground">
            <Link2Off className="size-5" aria-hidden />
          </span>
          <AccessEyebrow label={t.invite.eyebrow} />
          <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
            {t.invite.invalidTitle}
          </h1>
          <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
            {t.invite.invalidBody}
          </p>
        </AccessCard>
      </AccessShell>
    )
  }

  const ineligible = signedIn
    ? await diagnoseInvitationEligibility(signedIn.id, tokenHash!)
    : null

  return (
    <AccessShell lang={lang} topbarEnd={signOutButton}>
      <AccessCard className="max-w-130 p-7.5">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <UserPlus className="size-5" aria-hidden />
        </span>
        <AccessEyebrow label={t.invite.eyebrow} />
        <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
          {fmt(t.invite.title, {
            agency: preview.agencyName,
            client: preview.clientName,
          })}
        </h1>
        <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
          {t.invite.body}
        </p>
        {preview.boundToEmail ? (
          <p className="mt-2 text-[13px]/[1.6] text-muted-foreground">
            {t.invite.boundNote}
          </p>
        ) : null}

        {!signedIn ? (
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <Button asChild size="lg" className="flex-1">
              <Link
                href={`${localePath("/register", lang)}?invite=${encodeURIComponent(token)}`}
              >
                {t.invite.createAccount}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="flex-1">
              <Link
                href={`${localePath("/login", lang)}?invite=${encodeURIComponent(token)}`}
              >
                {t.invite.haveAccount}
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-4 text-[13px] text-muted-foreground">
              {fmt(t.invite.signedInAs, { email: signedIn.email })}
            </p>
            {ineligible ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-warning-soft-border bg-warning-soft px-3.5 py-3 text-[13.5px]/[1.55] text-warning-soft-foreground"
              >
                {t.invite.ineligible[ineligible]}
              </p>
            ) : (
              <AcceptInviteForm
                token={token}
                label={t.invite.accept}
                pendingLabel={t.invite.accepting}
              />
            )}
          </>
        )}
      </AccessCard>
    </AccessShell>
  )
}
