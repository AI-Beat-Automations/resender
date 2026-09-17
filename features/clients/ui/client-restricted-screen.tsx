import { CirclePause } from "lucide-react"

import { PostHogIdentify } from "@/components/posthog-identify"
import { SignOutForm } from "@/components/sign-out-form"
import { fmt, type AppDict } from "@/content/i18n/app"
import {
  AccessCard,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import type { Locale } from "@/content/i18n"
import { Button } from "@/components/ui/button"

// [Cuenta restringida] de un cliente (issue #154, ticket #156): el padre no
// tiene suscripción activa, o el acceso del cliente todavía no está activo.
// Es la pantalla que el padre ve como `/billing`, **sin CTA de pago**: el
// cliente no paga, así que lo único que puede hacer es cerrar sesión y
// esperar. La dibuja el layout de `(product)` en vez de redirigir: el cliente
// nunca pasa por `/billing` ni por `/pending`.
export function ClientRestrictedScreen({
  lang,
  t,
  user,
  ownerName,
  signOutAction,
}: {
  lang: Locale
  t: AppDict
  user: { id: string; email: string }
  /** Nulo cuando el acceso todavía no está activo y no hay padre resuelto. */
  ownerName: string | null
  signOutAction: () => Promise<void>
}) {
  return (
    <AccessShell
      lang={lang}
      topbarEnd={
        // `SignOutForm` hace el `posthog.reset()` antes de la server action.
        <SignOutForm action={signOutAction}>
          <Button type="submit" variant="outline">
            {t.clientRestricted.signOut}
          </Button>
        </SignOutForm>
      }
    >
      <PostHogIdentify distinctId={user.id} email={user.email} />
      <AccessCard className="max-w-130 p-7.5">
        <span className="flex size-11 items-center justify-center rounded-full bg-warning-soft text-warning-soft-foreground">
          <CirclePause className="size-5" aria-hidden />
        </span>
        <AccessEyebrow label={t.clientRestricted.eyebrow} />
        <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
          {t.clientRestricted.title}
        </h1>
        <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
          {ownerName
            ? fmt(t.clientRestricted.body, { owner: ownerName })
            : t.clientRestricted.bodyNoOwner}
        </p>
        <div className="mt-4.5 rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
          <p className="font-mono text-[13.5px]">{user.email}</p>
        </div>
      </AccessCard>
    </AccessShell>
  )
}
