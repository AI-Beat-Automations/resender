"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth/session"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { isPlanLookupKey } from "@/lib/billing/plans"
import { getStripe } from "@/lib/billing/stripe"
import {
  getStripeCustomerId,
  hasActiveSubscription,
  setStripeCustomerId,
} from "@/lib/billing/subscription"

// Las URLs de retorno de Stripe deben apuntar al mismo host del request: la
// cookie de sesión es host-only, y si APP_URL difiere (www vs apex) el
// regreso del Checkout aterriza sin sesión y rebota a /login.
async function getAppUrl(): Promise<string> {
  const requestHeaders = await headers()
  const host = requestHeaders.get("host")
  if (host) {
    const proto = requestHeaders.get("x-forwarded-proto") ?? "https"
    return `${proto}://${host}`
  }
  const appUrl = process.env.APP_URL
  if (!appUrl) throw new Error("APP_URL is required")
  return appUrl
}

// Crea la Checkout Session hosteada por Stripe para el plan elegido y
// redirige. El primer cobro ocurre dentro del propio Checkout (sin trial).
export async function startCheckout(lookupKey: string): Promise<void> {
  if (!isPlanLookupKey(lookupKey)) redirect("/billing")

  const session = await getSession()
  if (!session?.user?.id) redirect("/login")
  if (await isUserWaitlisted(session.user.id)) redirect("/waitlist")

  // Con suscripción activa no hay segundo Checkout: la gestión (cambiar plan,
  // cancelar) vive en el Customer Portal.
  if (await hasActiveSubscription(session.user.id)) {
    await openPortal()
  }

  const stripe = getStripe()
  const customerId = await ensureStripeCustomer(
    session.user.id,
    session.user.email ?? undefined
  )

  const prices = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  })
  const price = prices.data[0]
  if (!price) {
    throw new Error(`No Stripe price found for lookup key ${lookupKey}`)
  }

  // `session_id` permite a /billing/success verificar server-side que el
  // Checkout es de este usuario y está completado (no abre acceso: eso sigue
  // siendo del webhook).
  const appUrl = await getAppUrl()
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    // Promo codes / coupons from the Stripe Dashboard (Live or Test).
    allow_promotion_codes: true,
    metadata: { tenantId: session.user.id },
    subscription_data: { metadata: { tenantId: session.user.id } },
    success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/billing`,
  })
  if (!checkout.url) throw new Error("Stripe Checkout session has no URL")

  redirect(checkout.url)
}

// Abre el Customer Portal de Stripe, donde vive toda la gestión posterior:
// cambio de plan, método de pago y cancelación (al fin del período).
export async function openPortal(): Promise<void> {
  const session = await getSession()
  if (!session?.user?.id) redirect("/login")

  const customerId = await getStripeCustomerId(session.user.id)
  if (!customerId) redirect("/billing")

  const portal = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${await getAppUrl()}/settings`,
  })

  redirect(portal.url)
}

// Reutiliza el Customer del tenant o lo crea la primera vez que inicia
// Checkout; `metadata.tenantId` permite resolver el tenant en los webhooks.
async function ensureStripeCustomer(
  userId: string,
  email: string | undefined
): Promise<string> {
  const existing = await getStripeCustomerId(userId)
  if (existing) return existing

  // La idempotency key estable por usuario hace que dos requests concurrentes
  // (doble click, dos pestañas) reciban el mismo Customer en vez de crear dos.
  const customer = await getStripe().customers.create(
    {
      email,
      metadata: { tenantId: userId },
    },
    { idempotencyKey: `customer-create-${userId}` }
  )
  await setStripeCustomerId(userId, customer.id)
  return customer.id
}
