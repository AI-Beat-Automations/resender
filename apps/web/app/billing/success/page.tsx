import Link from "next/link"
import { redirect } from "next/navigation"
import { LoaderCircle } from "lucide-react"

import { auth } from "@/auth"
import { ActivationPoller } from "@/features/billing/ui/activation-poller"
import { AccessCard, AccessShell } from "@/features/auth/ui/access-shell"
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
    <AccessShell>
      <AccessCard className="max-w-130 p-7.5">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
        </span>
        <h1 className="mt-4.5 font-heading text-[22px] font-bold tracking-tight">
          Activando tu suscripción…
        </h1>
        <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
          Gracias por suscribirte. Estamos confirmando el pago con Stripe: suele
          tomar unos segundos y esta página te lleva adentro sola. No hace falta
          que recargues ni que vuelvas a pagar.
        </p>
        <p className="mt-4.5 text-[13px]/[1.6] text-muted-foreground">
          ¿Tarda más de lo esperado?{" "}
          <Link
            href="/connections"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Abre la app
          </Link>{" "}
          o escríbenos a{" "}
          <a
            href="mailto:info@resender.dev"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            info@resender.dev
          </a>
          .
        </p>
      </AccessCard>
      <ActivationPoller />
    </AccessShell>
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
