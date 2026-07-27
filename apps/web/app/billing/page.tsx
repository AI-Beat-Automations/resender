import Link from "next/link"
import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"
import { SiteFooter } from "@/components/site-footer"
import { startCheckout } from "@/features/billing/actions"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { PLANS } from "@/lib/billing/plans"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { Button } from "@workspace/ui/components/button"

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
    <div className="flex min-h-svh flex-col bg-[radial-gradient(circle_at_top_left,theme(colors.muted),transparent_34rem)]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-8">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Resender
        </Link>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/" })
          }}
        >
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-12">
        <div className="w-full max-w-4xl">
          <h1 className="text-center text-3xl font-semibold tracking-tight">
            Choose your plan
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Your account is approved. Pick a monthly plan to start using
            Resender — payment happens on a secure page hosted by Stripe.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <section
                key={plan.lookupKey}
                className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <h2 className="font-medium">{plan.name}</h2>
                <p className="mt-3">
                  <span className="text-3xl font-semibold tracking-tight">
                    ${plan.priceMonthlyUsd}
                  </span>{" "}
                  <span className="text-sm text-muted-foreground">/ month</span>
                </p>
                <form
                  action={startCheckout.bind(null, plan.lookupKey)}
                  className="mt-6 flex flex-1 items-end"
                >
                  <Button type="submit" className="w-full">
                    Subscribe
                  </Button>
                </form>
              </section>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Change plan, update your card or cancel anytime from Settings via
            the Stripe Customer Portal.
          </p>
        </div>
      </main>
      <SiteFooter lang="es" />
    </div>
  )
}
