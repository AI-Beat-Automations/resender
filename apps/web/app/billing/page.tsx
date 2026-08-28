import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"
import { PostHogIdentify } from "@/components/posthog-identify"
import { SignOutForm } from "@/components/sign-out-form"
import { AccessEyebrow, AccessShell } from "@/features/auth/ui/access-shell"
import { startCheckout } from "@/features/billing/actions"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { PLANS } from "@/lib/billing/plans"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { privatePageMetadata } from "@/lib/seo"
import { fmt } from "@/content/i18n/app"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

// La metadata es estática y no puede leer la cookie (Next la resuelve fuera del
// render): se queda en español, que es el idioma por defecto. Es un `<title>`
// de una página `noindex` que nadie busca, y volverla dinámica costaría
// renderizar la página entera dos veces.
export const metadata = privatePageMetadata("Suscripción")

// El plan destacado. El diseño marca Pro con el anillo violeta grueso.
const RECOMMENDED_PLAN = "pro_monthly"

// Pricing para cuentas sin suscripción activa. Vive fuera del grupo
// `(product)` a propósito: ese layout rebota aquí a los tenants sin
// suscripción, así que esta página no puede estar envuelta por él.
//
// Los dos rebotes de abajo son el resto del gate de acceso, que la ADR 0007
// dejó vivo pero inerte (`users.waitlisted` ya nace en `false`). Se separan
// porque se arreglan distinto: una sesión huérfana necesita volver a
// autenticarse, y una cuenta en lista de espera necesita que alguien le levante
// la bandera.
export default async function BillingPage() {
  const { lang, t } = await getAppI18n()
  const numberFormat = new Intl.NumberFormat(t.intl)
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const access = await resolveProductAccess(session.user.id)
  if (access === "unknown_user") redirect("/login")
  if (access === "waitlisted") redirect("/waitlist")
  if (await hasActiveSubscription(session.user.id)) redirect("/connections")

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
            {t.billing.signOut}
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
      <div className="flex w-full flex-col items-center">
        <AccessEyebrow label={t.billing.eyebrow} />
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">
          {t.billing.title}
        </h1>
        <p className="mt-2.5 max-w-130 text-center text-[15px]/[1.6] text-muted-foreground">
          {t.billing.subtitle}
        </p>
        <div className="mt-7 grid w-full max-w-155 gap-5 sm:grid-cols-2">
          {PLANS.map((plan) => {
            const recommended = plan.lookupKey === RECOMMENDED_PLAN
            return (
              <section
                key={plan.lookupKey}
                className={cn(
                  "flex flex-col gap-5 rounded-xl bg-card p-6",
                  recommended
                    ? "shadow-[inset_0_0_0_var(--border-width-thick)_var(--primary)]"
                    : "shadow-[var(--ring-hairline)]"
                )}
              >
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    {plan.name}
                  </h2>
                  <p className="mt-2.5 flex items-baseline gap-1.5">
                    <span className="font-heading text-4xl font-bold tracking-tight">
                      ${plan.priceMonthlyUsd}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t.billing.perMonth}
                    </span>
                  </p>
                  {/* Los límites junto al precio: `/billing` era la única
                      superficie donde se pagaba sin ver qué se compra. */}
                  <p className="mt-2 text-[13.5px] text-muted-foreground">
                    {fmt(
                      plan.limits.maxPages === 1
                        ? t.billing.planLimitsOne
                        : t.billing.planLimitsMany,
                      {
                        messages: numberFormat.format(
                          plan.limits.messagesPerPeriod
                        ),
                        pages: plan.limits.maxPages,
                      }
                    )}
                  </p>
                </div>
                <form
                  action={startCheckout.bind(null, plan.lookupKey)}
                  className="mt-auto"
                >
                  <Button
                    type="submit"
                    size="lg"
                    variant={recommended ? "default" : "outline"}
                    className="w-full"
                  >
                    {t.billing.subscribe}
                  </Button>
                </form>
              </section>
            )
          })}
        </div>
        <p className="mt-6 text-center text-[13.5px] text-muted-foreground">
          {t.billing.footnote}
        </p>
      </div>
    </AccessShell>
  )
}
