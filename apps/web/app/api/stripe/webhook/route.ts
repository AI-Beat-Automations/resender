import { type NextRequest } from "next/server"
import type Stripe from "stripe"

import { getStripe } from "@/lib/billing/stripe"
import {
  getTenantIdByStripeCustomerId,
  resolveTenantId,
  setStripeCustomerId,
  upsertSubscription,
} from "@/lib/billing/subscription"

// Replica el estado de las suscripciones de Stripe en Postgres. Espejo del
// webhook de Meta: firma verificada sobre el body crudo antes de parsear y
// respuesta 200 rápida (el upsert es idempotente y el siguiente evento
// reconcilia el estado si algo falla).
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const signature = request.headers.get("stripe-signature") ?? ""
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is required")
    return new Response("configuration error", { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret)
  } catch (error) {
    console.error("stripe webhook signature verification failed", error)
    return new Response("bad signature", { status: 400 })
  }

  try {
    await handleEvent(event)
  } catch (error) {
    console.error("stripe webhook processing failed", event.type, error)
  }

  return Response.json({ ok: true })
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
      await linkCustomerToTenant(event.data.object)
      break
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      // En `deleted` el snapshot ya viene con status `canceled`: el mismo
      // upsert cierra el acceso sin lógica especial por tipo de evento.
      await applySubscriptionSnapshot(event.data.object)
      break
  }
}

// El vínculo customer↔tenant se crea normalmente en `startCheckout`; esto es
// una red de seguridad idempotente por si la escritura local falló.
async function linkCustomerToTenant(session: Stripe.Checkout.Session) {
  const tenantId = session.metadata?.tenantId?.trim()
  const customerId = stripeId(session.customer)
  if (!tenantId || !customerId) return
  await setStripeCustomerId(tenantId, customerId)
}

async function applySubscriptionSnapshot(subscription: Stripe.Subscription) {
  const customerId = stripeId(subscription.customer)
  const metadataTenantId = subscription.metadata?.tenantId
  const tenantId = resolveTenantId({
    metadataTenantId,
    customerTenantId:
      !metadataTenantId?.trim() && customerId
        ? await getTenantIdByStripeCustomerId(customerId)
        : null,
  })
  if (!tenantId) {
    console.error("stripe subscription without resolvable tenant", {
      subscriptionId: subscription.id,
      customerId,
    })
    return
  }

  // En la API 2025+ de Stripe el período vive en cada subscription item; con
  // un solo price por suscripción, el primer item es la suscripción entera.
  const item = subscription.items.data[0]
  await upsertSubscription({
    tenantId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    priceLookupKey: item?.price.lookup_key ?? item?.price.id ?? "unknown",
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  })
}

function stripeId(
  value: string | { id: string } | null | undefined
): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}
