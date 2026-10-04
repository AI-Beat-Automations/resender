import type Stripe from "stripe"

import { getStripe } from "@/lib/billing/stripe"
import { posthog } from "@/lib/posthog"

import {
  analyticsPlanOf,
  planMrr,
  type AnalyticsPlan,
  type AnalyticsSubscriptionStatus,
} from "./plans"

// Eventos de suscripción y cobro para PostHog, todos desde el webhook de
// Stripe: es el único lugar donde se sabe con certeza qué pasó. Sirven para
// sacar MRR y conversión sin conectar Stripe a PostHog.
//
// **Nada de acá puede hacer fallar el webhook.** El llamador envuelve cada
// llamada en `try/catch`: un 500 por analítica haría que Stripe reintente un
// evento que ya se aplicó a la base. Las lecturas extra a Stripe (cupón,
// facturas previas) son pocas por cliente y por mes, fuera de cualquier hot
// path.
//
// El `distinct_id` es el tenant, que para el [Padre] es su user id
// (CONTEXT.md → [Tenant]): la misma persona que el resto de los eventos.

const SECONDS_PER_DAY = 60 * 60 * 24

type CouponInfo = {
  code: string
  // Quién reparte el código (`lori`, `arturo`, `community`, `event`): sale de
  // `metadata.owner` del código promocional o, si no, del cupón en Stripe.
  owner: string | null
}

// ---------------------------------------------------------------------------
// checkout.session.completed → `checkout completed` + `coupon redeemed`
// ---------------------------------------------------------------------------

export async function captureCheckoutCompleted(
  tenantId: string,
  session: Stripe.Checkout.Session,
  event: Stripe.Event
): Promise<void> {
  if (!posthog) return
  // `priceLookupKey` lo escribe `startCheckout` en la metadata de la sesión;
  // el webhook no trae los line items.
  const plan = analyticsPlanOf(session.metadata?.priceLookupKey)
  const coupon = await resolveCheckoutCoupon(session)
  const timestamp = eventTime(event)

  posthog.capture({
    distinctId: tenantId,
    event: "checkout completed",
    timestamp,
    properties: {
      stripe_customer_id: stripeId(session.customer),
      plan,
      coupon_code: coupon?.code ?? null,
    },
  })

  // Los cupones solo se canjean en el Checkout (`allow_promotion_codes`): el
  // alta no tiene campo de código.
  if (coupon) {
    posthog.capture({
      distinctId: tenantId,
      event: "coupon redeemed",
      timestamp,
      properties: {
        coupon_code: coupon.code,
        coupon_owner: coupon.owner,
        plan,
        $set_once: { coupon_code: coupon.code },
      },
    })
  }

  await posthog.flush()
}

async function resolveCheckoutCoupon(
  session: Stripe.Checkout.Session
): Promise<CouponInfo | null> {
  const promotionCodeId = session.discounts
    ?.map((discount) => stripeId(discount.promotion_code))
    .find(Boolean)
  if (!promotionCodeId) return null
  const promotionCode = await withCouponExpansion(
    (expand) =>
      getStripe().promotionCodes.retrieve(promotionCodeId, { expand }),
    ["promotion.coupon"]
  )
  return promotionCode ? couponInfoOf(promotionCode) : null
}

// ---------------------------------------------------------------------------
// customer.subscription.* → started / updated / canceled
// ---------------------------------------------------------------------------

export async function captureSubscriptionEvent(
  tenantId: string,
  subscription: Stripe.Subscription,
  event: Stripe.Event
): Promise<void> {
  if (!posthog) return
  const lookupKey = lookupKeyOf(subscription)
  const plan = analyticsPlanOf(lookupKey)
  const timestamp = eventTime(event)
  const base = {
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    price_lookup_key: lookupKey,
  }

  // Precedencia de siempre: un `created` que ya llega cancelado cuenta como
  // cancelación.
  if (subscription.status === "canceled") {
    const customerId = stripeId(subscription.customer)
    const details = subscription.cancellation_details
    posthog.capture({
      distinctId: tenantId,
      event: "subscription canceled",
      timestamp,
      properties: {
        ...base,
        plan,
        mrr_lost: planMrr(plan),
        tenure_days: Math.max(
          0,
          Math.floor((event.created - subscription.start_date) / SECONDS_PER_DAY)
        ),
        // Canceló sin haber pagado nunca: el cupón cubrió todo lo que usó.
        was_coupon_period: customerId
          ? !(await hasPaidInvoice(customerId))
          : false,
        cancel_reason: details?.feedback ?? details?.reason ?? null,
        $set: { plan: "free", subscription_status: "canceled", mrr: 0 },
      },
    })
  } else if (event.type === "customer.subscription.created") {
    const coupon = await resolveSubscriptionCoupon(subscription.id)
    posthog.capture({
      distinctId: tenantId,
      event: "subscription started",
      timestamp,
      properties: {
        ...base,
        plan,
        mrr: planMrr(plan),
        coupon_code: coupon?.code ?? null,
        coupon_period_ends_at: coupon?.periodEndsAt ?? null,
        $set: {
          plan,
          subscription_status: subscriptionStatusOf(
            subscription.status,
            coupon?.coversFirstInvoice ?? false
          ),
          mrr: planMrr(plan),
        },
      },
    })
  } else if (event.type === "customer.subscription.updated") {
    // Solo cuando cambió el precio: el resto de los `updated` (renovación,
    // `cancel_at_period_end`, método de pago) no mueven el MRR.
    const previous = (
      event.data.previous_attributes as Partial<Stripe.Subscription> | undefined
    )?.items?.data?.[0]?.price
    if (!previous) return
    const fromPlan = analyticsPlanOf(previous.lookup_key ?? previous.id)
    if (fromPlan === plan) return
    const mrrBefore = planMrr(fromPlan)
    const mrrAfter = planMrr(plan)
    posthog.capture({
      distinctId: tenantId,
      event: "subscription updated",
      timestamp,
      properties: {
        ...base,
        from_plan: fromPlan,
        to_plan: plan,
        direction: mrrAfter >= mrrBefore ? "upgrade" : "downgrade",
        mrr_before: mrrBefore,
        mrr_after: mrrAfter,
        $set: { plan, mrr: mrrAfter },
      },
    })
  } else {
    return
  }

  await posthog.flush()
}

async function resolveSubscriptionCoupon(subscriptionId: string): Promise<
  | (CouponInfo & {
      periodEndsAt: string | null
      // La primera factura salió en $0 por el cupón: la suscripción está
      // `active` en Stripe, pero todavía no pagó nada.
      coversFirstInvoice: boolean
    })
  | null
> {
  const subscription = await withCouponExpansion(
    (expand) => getStripe().subscriptions.retrieve(subscriptionId, { expand }),
    ["discounts.promotion_code", "latest_invoice"],
    ["discounts.source.coupon"]
  )
  if (!subscription) return null
  const discount = subscription.discounts.find(
    (candidate): candidate is Stripe.Discount => typeof candidate !== "string"
  )
  if (!discount) return null

  const promotionCode =
    discount.promotion_code && typeof discount.promotion_code !== "string"
      ? discount.promotion_code
      : null
  const coupon =
    discount.source.coupon && typeof discount.source.coupon !== "string"
      ? discount.source.coupon
      : null
  const code = promotionCode?.code ?? coupon?.name ?? coupon?.id
  if (!code) return null

  const latestInvoice =
    subscription.latest_invoice &&
    typeof subscription.latest_invoice !== "string"
      ? subscription.latest_invoice
      : null
  // Un cupón `once` no tiene `end`: dura lo que el primer período.
  const periodEnd =
    discount.end ?? subscription.items.data[0]?.current_period_end ?? null

  return {
    code,
    owner: ownerOf(promotionCode?.metadata) ?? ownerOf(coupon?.metadata),
    periodEndsAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    coversFirstInvoice: latestInvoice?.amount_paid === 0,
  }
}

// ---------------------------------------------------------------------------
// invoice.paid / invoice.payment_failed → `invoice paid` / `payment failed`
// ---------------------------------------------------------------------------

// El tenant de una factura: la metadata que `startCheckout` le pone a la
// suscripción viaja copiada en `parent.subscription_details`.
export function invoiceTenantHint(invoice: Stripe.Invoice): string | null {
  return invoice.parent?.subscription_details?.metadata?.tenantId ?? null
}

export async function captureInvoiceEvent(
  tenantId: string,
  invoice: Stripe.Invoice,
  event: Stripe.Event
): Promise<void> {
  if (!posthog) return
  const customerId = stripeId(invoice.customer)
  const isPaid = event.type === "invoice.paid"
  // Las facturas en $0 del período con cupón no son ingreso.
  if (isPaid && invoice.amount_paid <= 0) return

  const plan = await planOfInvoice(invoice)
  const isFirstPayment = customerId
    ? !(await hasPaidInvoice(customerId, invoice.id))
    : false
  const timestamp = eventTime(event)

  if (isPaid) {
    posthog.capture({
      distinctId: tenantId,
      event: "invoice paid",
      timestamp,
      properties: {
        amount: toDollars(invoice.amount_paid),
        currency: "USD",
        plan,
        billing_reason: invoice.billing_reason,
        is_first_payment: isFirstPayment,
        stripe_invoice_id: invoice.id,
        $set: { subscription_status: "active" },
        $set_once: {
          first_paid_at: new Date(event.created * 1000).toISOString(),
        },
      },
    })
  } else {
    posthog.capture({
      distinctId: tenantId,
      event: "payment failed",
      timestamp,
      properties: {
        amount: toDollars(invoice.amount_due),
        currency: "USD",
        plan,
        attempt_count: invoice.attempt_count,
        is_first_payment: isFirstPayment,
        stripe_invoice_id: invoice.id,
        $set: { subscription_status: "past_due" },
      },
    })
  }

  await posthog.flush()
}

async function planOfInvoice(invoice: Stripe.Invoice): Promise<AnalyticsPlan> {
  const subscriptionId = stripeId(
    invoice.parent?.subscription_details?.subscription
  )
  if (!subscriptionId) return "free"
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId)
  return analyticsPlanOf(lookupKeyOf(subscription))
}

// ¿El customer ya pagó alguna factura con monto? Las de $0 del cupón no
// cuentan. Con un cliente por mes, las primeras 100 facturas alcanzan.
async function hasPaidInvoice(
  customerId: string,
  excludeInvoiceId?: string
): Promise<boolean> {
  const invoices = await getStripe().invoices.list({
    customer: customerId,
    status: "paid",
    limit: 100,
  })
  return invoices.data.some(
    (invoice) => invoice.id !== excludeInvoiceId && invoice.amount_paid > 0
  )
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function subscriptionStatusOf(
  status: Stripe.Subscription.Status,
  inCouponPeriod: boolean
): AnalyticsSubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return inCouponPeriod ? "coupon_period" : "active"
    case "past_due":
    case "unpaid":
      return "past_due"
    case "canceled":
      return "canceled"
    default:
      return "none"
  }
}

// Expandir el cupón pide el permiso «Coupons: read» en la restricted key. Sin
// él, Stripe rechaza la lectura **entera**, y con ella se perdería el evento
// completo y no solo el dueño del cupón. Por eso se reintenta sin expandir el
// cupón (el código y el `owner` del código promocional siguen saliendo), y si
// aun así falla, el evento sale sin cupón.
async function withCouponExpansion<T>(
  read: (expand: string[]) => Promise<T>,
  expand: string[],
  couponExpand: string[] = []
): Promise<T | null> {
  const attempts =
    couponExpand.length > 0
      ? [[...expand, ...couponExpand], expand]
      : [expand, expand.filter((path) => !path.endsWith("coupon"))]
  for (const attempt of attempts) {
    try {
      return await read(attempt)
    } catch (error) {
      console.warn("stripe coupon lookup failed", attempt, error)
    }
  }
  return null
}

function couponInfoOf(promotionCode: Stripe.PromotionCode): CouponInfo {
  const coupon =
    promotionCode.promotion.coupon &&
    typeof promotionCode.promotion.coupon !== "string"
      ? promotionCode.promotion.coupon
      : null
  return {
    code: promotionCode.code,
    owner: ownerOf(promotionCode.metadata) ?? ownerOf(coupon?.metadata),
  }
}

function ownerOf(metadata: Stripe.Metadata | null | undefined): string | null {
  const owner = metadata?.owner?.trim().toLowerCase()
  return owner || null
}

function lookupKeyOf(subscription: Stripe.Subscription): string | null {
  const price = subscription.items.data[0]?.price
  return price?.lookup_key ?? price?.id ?? null
}

function toDollars(cents: number): number {
  return Math.round(cents) / 100
}

// La hora del evento en Stripe y no la de proceso: un reintento horas después
// cae en el día correcto del dashboard.
function eventTime(event: Stripe.Event): Date {
  return new Date(event.created * 1000)
}

function stripeId(
  value: string | { id: string } | null | undefined
): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}
