import { type NextRequest } from "next/server"
import type Stripe from "stripe"

import { getStripe } from "@/lib/billing/stripe"
import {
  getTenantIdByStripeCustomerId,
  resolveTenantId,
  setStripeCustomerId,
  upsertSubscription,
} from "@/lib/billing/subscription"
import { posthog } from "@/lib/posthog"

// Replica el estado de las suscripciones de Stripe en Postgres. Espejo del
// webhook de Meta: firma verificada sobre el body crudo antes de parsear.
// A diferencia del de Meta, un fallo de procesamiento responde 500: Stripe
// reintenta con backoff hasta ~3 días y el upsert idempotente reconcilia;
// tras un `customer.subscription.deleted` perdido no llega ningún evento
// posterior que corrija el estado, así que el retry es la única red.
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
    // constructEventAsync usa WebCrypto: requerido en Cloudflare Workers.
    event = await getStripe().webhooks.constructEventAsync(
      raw,
      signature,
      secret
    )
  } catch (error) {
    console.error("stripe webhook signature verification failed", error)
    return new Response("bad signature", { status: 400 })
  }

  try {
    await handleEvent(event)
  } catch (error) {
    console.error("stripe webhook processing failed", event.type, error)
    return new Response("processing failed", { status: 500 })
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
      await applySubscriptionSnapshot(event)
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

  if (posthog) {
    posthog.capture({
      distinctId: tenantId,
      event: "checkout completed",
      properties: { stripe_customer_id: customerId },
    })
    await posthog.flush()
  }
}

async function applySubscriptionSnapshot(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription
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
    // Lanzar (→ 500 → retry de Stripe) es autocurativo cuando este evento
    // llegó antes que el `checkout.session.completed` que vincula el
    // customer con el tenant.
    throw new Error(
      `stripe subscription without resolvable tenant: ${subscription.id} (customer ${customerId})`
    )
  }

  // En la API 2025+ de Stripe el período vive en cada subscription item; con
  // un solo price por suscripción, el primer item es la suscripción entera.
  const item = subscription.items.data[0]
  const { supersededSubscriptionId } = await upsertSubscription({
    tenantId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    priceLookupKey: item?.price.lookup_key ?? item?.price.id ?? "unknown",
    currentPeriodStart: item?.current_period_start
      ? new Date(item.current_period_start * 1000)
      : null,
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    lastStripeEventAt: new Date(event.created * 1000),
  })

  if (supersededSubscriptionId) {
    await cancelSupersededSubscription(tenantId, supersededSubscriptionId)
  }

  if (posthog) {
    const isCanceled = subscription.status === "canceled"
    const isNew = event.type === "customer.subscription.created"
    if (isNew || isCanceled) {
      const properties = {
        stripe_subscription_id: subscription.id,
        status: subscription.status,
        price_lookup_key: item?.price.lookup_key ?? item?.price.id ?? "unknown",
      }
      // Dos capture con nombre literal en vez de un ternario en `event`: los
      // nombres dinámicos no se pueden verificar estáticamente ni cruzar con la
      // taxonomía de PostHog. El orden (cancelado primero) preserva la
      // precedencia original: un `created` que ya llega cancelado sigue
      // contando como cancelación.
      if (isCanceled) {
        posthog.capture({
          distinctId: tenantId,
          event: "subscription canceled",
          properties,
        })
      } else {
        posthog.capture({
          distinctId: tenantId,
          event: "subscription started",
          properties,
        })
      }
      await posthog.flush()
    }
  }
}

// Dos Checkouts completados en paralelo dejan al tenant con dos suscripciones
// vivas; solo una cabe en la fila. La sobrante se cancela y se reembolsa su
// último cobro (decisión de producto: el usuario nunca paga doble).
// Best-effort: un fallo aquí no debe fallar el webhook — el retry del evento
// (upsert idempotente) volverá a intentarlo, y `subscriptions.cancel` sobre
// una suscripción ya cancelada no se reintenta gracias al retrieve previo.
async function cancelSupersededSubscription(
  tenantId: string,
  subscriptionId: string
) {
  try {
    const stripe = getStripe()
    const current = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["latest_invoice.payments"],
    })
    if (current.status === "canceled") return

    await stripe.subscriptions.cancel(subscriptionId)
    console.log("canceled duplicate stripe subscription", {
      tenantId,
      subscriptionId,
    })

    const invoice = current.latest_invoice
    const payments =
      invoice && typeof invoice !== "string"
        ? (invoice.payments?.data ?? [])
        : []
    const paymentIntentId = payments
      .map((p) => stripeId(p.payment.payment_intent))
      .find(Boolean)
    if (paymentIntentId) {
      await stripe.refunds.create({ payment_intent: paymentIntentId })
      console.log("refunded duplicate stripe subscription charge", {
        tenantId,
        subscriptionId,
        paymentIntentId,
      })
    }
  } catch (error) {
    console.error("failed to cancel duplicate stripe subscription", {
      tenantId,
      subscriptionId,
      error,
    })
  }
}

function stripeId(
  value: string | { id: string } | null | undefined
): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}
