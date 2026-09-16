import { HtmlLang } from "@/components/html-lang"
import { AppI18nProvider } from "@/content/i18n/app/provider"
import { fmt, type AppDict } from "@/content/i18n/app"
import { AcceptInvitationForm } from "@/features/clients/ui/accept-invitation-form"
import {
  AccessCard,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { peekInvitation, type InvitationPeek } from "@/lib/clients/invitations"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { privatePageMetadata } from "@/lib/seo"

// `/invitacion/[token]` (issue #154, ticket #156): el cliente acepta la
// [Invitacion de cliente], fija su contraseña y entra con sesión abierta.
//
// Vive **fuera** del grupo `(product)` a propósito, como `/reset-password`:
// quien llega no tiene sesión —todavía no existe como user— y ese layout lo
// rebotaría a `/login`. Por eso no lleva el slot `@header` de la consola:
// usa el chrome de las pantallas de acceso. El idioma sale de la cookie del
// producto (`getAppI18n`), que es donde vive todo el copy del módulo.
//
// El `peek` va **antes** del formulario, como en `/reset-password`: un enlace
// vencido, cancelado o ya usado se explica sin acción. No consume nada; la
// autoridad sobre el token es `acceptInvitation`.

// Estática y en español por el mismo motivo que en `/billing`: la metadata se
// resuelve fuera del render, sin acceso a la cookie de idioma.
export const metadata = privatePageMetadata("Invitación")

type InvitationPageProps = {
  params: Promise<{ token: string }>
}

export default async function InvitationPage({ params }: InvitationPageProps) {
  const [{ token }, { lang, t }] = await Promise.all([params, getAppI18n()])
  const peek = await peekInvitation(token)

  return (
    <AccessShell lang={lang}>
      <HtmlLang lang={lang} />
      <AccessCard className="max-w-100">
        <AccessEyebrow label={t.invitation.eyebrow} />
        {peek.state === "live" ? (
          <>
            <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
              {t.invitation.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {fmt(t.invitation.body, { owner: peek.ownerName })}
            </p>
            {/* El formulario es cliente y lee el diccionario por contexto,
                como los del producto: el provider baja solo el idioma en uso. */}
            <AppI18nProvider lang={lang} dict={t}>
              <AcceptInvitationForm
                token={token}
                clientName={peek.clientName}
                email={peek.email}
              />
            </AppI18nProvider>
          </>
        ) : (
          <DeadInvitation state={peek.state} t={t} />
        )}
      </AccessCard>
    </AccessShell>
  )
}

// Sin acción a propósito: el padre reenvía desde `/clientes`, y un botón acá
// no tendría a quién pedirle nada.
function DeadInvitation({
  state,
  t,
}: {
  state: Exclude<InvitationPeek["state"], "live">
  t: AppDict
}) {
  const copy: Record<typeof state, { title: string; body: string }> = {
    expired: {
      title: t.invitation.expiredTitle,
      body: t.invitation.expiredBody,
    },
    cancelled: {
      title: t.invitation.cancelledTitle,
      body: t.invitation.cancelledBody,
    },
    consumed: {
      title: t.invitation.consumedTitle,
      body: t.invitation.consumedBody,
    },
    unknown: {
      title: t.invitation.unknownTitle,
      body: t.invitation.unknownBody,
    },
  }
  const { title, body } = copy[state]

  return (
    <>
      <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </>
  )
}
