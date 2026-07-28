import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"
import { AccessEyebrow, AccessShell } from "@/features/auth/ui/access-shell"
import { startCheckout } from "@/features/billing/actions"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { PLANS } from "@/lib/billing/plans"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { privatePageMetadata } from "@/lib/seo"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export const metadata = privatePageMetadata("Suscripción")

// El plan destacado. El diseño marca Pro con el anillo violeta grueso.
const RECOMMENDED_PLAN = "pro_monthly"

const numberFormat = new Intl.NumberFormat("es-ES")

// Pricing para cuentas aprobadas en waitlist sin suscripción activa. Vive
// fuera del grupo `(product)` a propósito (análogo a `/waitlist`): ese layout
// rebota aquí a los tenants sin suscripción, así que esta página no puede
// estar envuelta por él.
export default async function BillingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  if (await isUserWaitlisted(session.user.id)) redirect("/waitlist")
  if (await hasActiveSubscription(session.user.id)) redirect("/connections")

  return (
    <AccessShell
      topbarEnd={
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/" })
          }}
        >
          <Button type="submit" variant="outline">
            Cerrar sesión
          </Button>
        </form>
      }
    >
      <div className="flex w-full flex-col items-center">
        <AccessEyebrow label="pricing" />
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">
          Elige tu plan.
        </h1>
        <p className="mt-2.5 max-w-130 text-center text-[15px]/[1.6] text-muted-foreground">
          Tu cuenta está aprobada. El pago ocurre en una página segura de
          Stripe.
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
                    <span className="text-sm text-muted-foreground">/ mes</span>
                  </p>
                  {/* Los límites junto al precio: `/billing` era la única
                      superficie donde se pagaba sin ver qué se compra. */}
                  <p className="mt-2 text-[13.5px] text-muted-foreground">
                    {numberFormat.format(plan.limits.messagesPerPeriod)}{" "}
                    mensajes · {plan.limits.maxPages}{" "}
                    {plan.limits.maxPages === 1 ? "página" : "páginas"}
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
                    Suscribirme
                  </Button>
                </form>
              </section>
            )
          })}
        </div>
        <p className="mt-6 text-center text-[13.5px] text-muted-foreground">
          Cambia de plan, actualiza tu tarjeta o cancela cuando quieras desde
          Ajustes, con el portal de Stripe.
        </p>
      </div>
    </AccessShell>
  )
}
