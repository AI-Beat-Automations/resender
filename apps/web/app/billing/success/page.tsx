import Link from "next/link"
import { redirect } from "next/navigation"
import { LoaderCircle } from "lucide-react"

import { auth } from "@/auth"
import { SiteFooter } from "@/components/site-footer"
import { ActivationPoller } from "@/features/billing/ui/activation-poller"
import { getStripe } from "@/lib/billing/stripe"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata("Activando tu suscripción")

type BillingSuccessPageProps = {
  searchParams: Promise<{ session_id?: string }>
}

// Página de vuelta desde Stripe Checkout. No abre acceso por sí misma: el
// acceso real lo abre el webhook al replicar la suscripción en Postgres, así
// que aquí solo se espera (con refresh ligero) a que el gate la vea. El
// `session_id` del redirect solo se usa para verificar que quien llega tiene
// un Checkout propio y completado; sin él (o con el de otro usuario) se
// rebota al pricing.
export default async function BillingSuccessPage({
  searchParams,
}: BillingSuccessPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams])
  if (!session?.user?.id) redirect("/login")
  if (await hasActiveSubscription(session.user.id)) redirect("/connections")

  if (!(await isOwnCompletedCheckout(params.session_id, session.user.id))) {
    redirect("/billing")
  }

  return (
    <div className="flex min-h-svh flex-col bg-[radial-gradient(circle_at_top_left,theme(colors.muted),transparent_34rem)]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-8">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Resender
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-12">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-sm">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Activating your subscription…
          </h1>
          <p className="mt-3 text-muted-foreground">
            Thanks for subscribing. We&apos;re confirming your payment with
            Stripe — this usually takes a few seconds and this page will move
            you along automatically.
          </p>
          <p className="mt-6 text-sm text-muted-foreground">
            Taking longer than expected?{" "}
            <Link
              href="/connections"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Try opening the app
            </Link>{" "}
            or reach us at{" "}
            <a
              href="mailto:info@resender.dev"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              info@resender.dev
            </a>
            .
          </p>
        </div>
      </main>
      <SiteFooter lang="es" />
      <ActivationPoller />
    </div>
  )
}

async function isOwnCompletedCheckout(
  sessionId: string | undefined,
  userId: string
): Promise<boolean> {
  if (!sessionId) return false
  try {
    const checkout = await getStripe().checkout.sessions.retrieve(sessionId)
    return (
      checkout.metadata?.tenantId === userId && checkout.status === "complete"
    )
  } catch (error) {
    console.error("checkout session verification failed", sessionId, error)
    return false
  }
}
