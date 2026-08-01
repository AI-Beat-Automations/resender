import { getSql } from "@/lib/db"

// Estado de la suscripción replicado desde Stripe vía webhooks (una fila por
// tenant). El gate lee siempre de esta tabla, nunca de la API de Stripe en el
// hot path. Espejo del patrón de `lib/auth/waitlist.ts`.

export type SubscriptionRow = {
  tenant_id: string
  stripe_subscription_id: string
  status: string
  price_lookup_key: string
  current_period_start: Date | null
  current_period_end: Date | null
  cancel_at_period_end: boolean
  last_stripe_event_at: Date | null
}

export type SubscriptionRecord = {
  tenantId: string
  stripeSubscriptionId: string
  status: string
  priceLookupKey: string
  // Inicio del período de facturación vigente: es la ventana de la cuota de
  // mensajes (ADR 0003), no el mes calendario.
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  lastStripeEventAt: Date | null
}

export function mapSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    tenantId: row.tenant_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    priceLookupKey: row.price_lookup_key,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    lastStripeEventAt: row.last_stripe_event_at,
  }
}

type MaybeStatusRow = { status: string } | null | undefined

// Fail closed: solo `active` abre acceso. Fila ausente, cualquier otro status
// (`past_due` incluido, decisión del ADR 0002) o error = sin acceso.
export function hasActiveStatus(row: MaybeStatusRow): boolean {
  return row?.status === "active"
}

export async function hasActiveSubscription(
  tenantId: string
): Promise<boolean> {
  try {
    const sql = getSql()
    const [row] = await sql<{ status: string }[]>`
      select status
      from subscriptions
      where tenant_id = ${tenantId}
      limit 1
    `
    return hasActiveStatus(row)
  } catch (error) {
    console.error("subscription access check failed", error)
    return false
  }
}

export async function getSubscriptionByTenantId(
  tenantId: string
): Promise<SubscriptionRecord | null> {
  const sql = getSql()
  const [row] = await sql<SubscriptionRow[]>`
    select tenant_id, stripe_subscription_id, status, price_lookup_key,
      current_period_start, current_period_end, cancel_at_period_end,
      last_stripe_event_at
    from subscriptions
    where tenant_id = ${tenantId}
    limit 1
  `
  return row ? mapSubscription(row) : null
}

export type SubscriptionUpsertInput = {
  tenantId: string
  stripeSubscriptionId: string
  status: string
  priceLookupKey: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  // `created` del evento de Stripe que trae este snapshot: es lo que ordena
  // eventos repetidos o fuera de orden, incluso dentro del mismo período.
  lastStripeEventAt: Date
}

// Estados en los que una suscripción ya no puede volver a la vida. Una baja
// tardía de una suscripción vieja no debe pisar la fila de una nueva.
const TERMINAL_STATUSES = ["canceled", "incomplete_expired"]

function isLiveStatus(status: string): boolean {
  return !TERMINAL_STATUSES.includes(status)
}

// Decisión pura del upsert (testeable sin DB). Los webhooks de Stripe pueden
// llegar repetidos o fuera de orden y cada evento trae un snapshot completo,
// así que el orden real lo da `event.created` (guardado en la fila):
// - fila sin marca (anterior a la migración 0006) → aplicar;
// - misma suscripción: aplicar solo si el evento no es más viejo que el
//   aplicado (un `updated(active)` rezagado no debe pisar un `past_due` o un
//   `deleted` posteriores);
// - suscripción distinta: reemplaza solo si viene viva Y con evento más
//   nuevo; ni un `deleted` tardío ni un `created` rezagado de la suscripción
//   anterior deben sobreescribir la vigente.
export function shouldApplySubscriptionEvent(
  existing: SubscriptionRecord | null,
  incoming: SubscriptionUpsertInput
): boolean {
  if (!existing) return true
  if (!existing.lastStripeEventAt) return true

  const isNewerOrSame =
    incoming.lastStripeEventAt.getTime() >= existing.lastStripeEventAt.getTime()

  if (existing.stripeSubscriptionId === incoming.stripeSubscriptionId) {
    return isNewerOrSame
  }

  return isLiveStatus(incoming.status) && isNewerOrSame
}

// Detección pura de suscripciones duplicadas (dos Checkouts completados en
// paralelo): si la fila y el snapshot apuntan a suscripciones distintas y
// ambas siguen vivas, una de las dos sobra en Stripe — la que pierde según el
// orden de eventos. El webhook la cancela y reembolsa (decisión de producto).
export function findSupersededSubscriptionId(
  existing: SubscriptionRecord | null,
  incoming: SubscriptionUpsertInput
): string | null {
  if (!existing) return null
  if (existing.stripeSubscriptionId === incoming.stripeSubscriptionId)
    return null
  if (!isLiveStatus(existing.status) || !isLiveStatus(incoming.status))
    return null

  return shouldApplySubscriptionEvent(existing, incoming)
    ? existing.stripeSubscriptionId
    : incoming.stripeSubscriptionId
}

export type SubscriptionUpsertResult = {
  applied: boolean
  // Suscripción viva que quedó fuera de la fila del tenant (duplicado por
  // doble Checkout); el caller debe cancelarla en Stripe.
  supersededSubscriptionId: string | null
}

// Upsert idempotente por tenant (una fila por tenant, PK = tenant_id). El
// read-decide-write no es atómico, pero el volumen de webhooks es mínimo y
// Stripe reintenta: el último evento válido reconcilia el estado.
export async function upsertSubscription(
  input: SubscriptionUpsertInput
): Promise<SubscriptionUpsertResult> {
  const existing = await getSubscriptionByTenantId(input.tenantId)
  const supersededSubscriptionId = findSupersededSubscriptionId(existing, input)

  if (!shouldApplySubscriptionEvent(existing, input)) {
    return { applied: false, supersededSubscriptionId }
  }

  const sql = getSql()
  await sql`
    insert into subscriptions (
      tenant_id, stripe_subscription_id, status, price_lookup_key,
      current_period_start, current_period_end, cancel_at_period_end,
      last_stripe_event_at
    ) values (
      ${input.tenantId}, ${input.stripeSubscriptionId}, ${input.status},
      ${input.priceLookupKey}, ${input.currentPeriodStart},
      ${input.currentPeriodEnd}, ${input.cancelAtPeriodEnd},
      ${input.lastStripeEventAt}
    )
    on conflict (tenant_id) do update set
      stripe_subscription_id = excluded.stripe_subscription_id,
      status = excluded.status,
      price_lookup_key = excluded.price_lookup_key,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      last_stripe_event_at = excluded.last_stripe_event_at,
      updated_at = now()
  `
  return { applied: true, supersededSubscriptionId }
}

// Snapshot mínimo de una suscripción de Stripe visto por el webhook. Los
// campos de período aparecen en el item (API 2025-03-31.basil en adelante) o en
// la raíz (versiones anteriores), y ambos son opcionales por eso mismo.
type SubscriptionPeriodSnapshot = {
  current_period_start?: number | null
  current_period_end?: number | null
  items: {
    data: Array<{
      current_period_start?: number | null
      current_period_end?: number | null
    }>
  }
}

export type SubscriptionPeriod = {
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
}

// El período de facturación cambió de lugar en la API 2025-03-31.basil: pasó de
// la raíz de la suscripción a cada subscription item. Cada webhook endpoint del
// Dashboard queda pinneado a la versión de API vigente cuando se creó, así que
// un endpoint viejo entrega snapshots con el período en la raíz. Leer solo el
// item ahí no falla — deja el período en NULL y la cuota de mensajes (ADR 0003)
// se queda sin ventana. Se lee el item primero (forma canónica) y se cae a la
// raíz, para que la ingesta no dependa de cómo se creó el endpoint.
export function resolveSubscriptionPeriod(
  subscription: SubscriptionPeriodSnapshot
): SubscriptionPeriod {
  const item = subscription.items.data[0]
  return {
    currentPeriodStart: epochToDate(
      item?.current_period_start ?? subscription.current_period_start
    ),
    currentPeriodEnd: epochToDate(
      item?.current_period_end ?? subscription.current_period_end
    ),
  }
}

type SubscriptionCancellationSnapshot = {
  cancel_at?: number | null
  cancel_at_period_end?: boolean | null
}

// La baja programada también cambió de representación. Hasta las versiones
// viejas de la API, cancelar al fin del período ponía `cancel_at_period_end` en
// `true`; desde `2026-07-29.dahlia` Stripe deja ese booleano en `false` y
// expresa la baja poniendo `cancel_at` con el timestamp del corte. Leer solo el
// booleano no falla: simplemente nunca se entera de la cancelación, y el panel
// de billing le sigue diciendo al usuario que su suscripción "renueva" cuando
// en realidad termina. Cualquiera de las dos formas significa lo mismo para el
// producto, así que basta con que una esté presente.
export function resolveCancelAtPeriodEnd(
  subscription: SubscriptionCancellationSnapshot
): boolean {
  return (
    subscription.cancel_at_period_end === true ||
    typeof subscription.cancel_at === "number"
  )
}

function epochToDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null
}

type TenantIdCandidates = {
  metadataTenantId: string | null | undefined
  customerTenantId: string | null | undefined
}

// Resolución pura del tenant de un evento: `metadata.tenantId` (sembrado al
// crear Customer y Subscription) gana; si falta, cae al mapeo por
// `stripe_customer_id` resuelto contra `users`.
export function resolveTenantId({
  metadataTenantId,
  customerTenantId,
}: TenantIdCandidates): string | null {
  const fromMetadata = metadataTenantId?.trim()
  if (fromMetadata) return fromMetadata
  const fromCustomer = customerTenantId?.trim()
  return fromCustomer || null
}

export async function getTenantIdByStripeCustomerId(
  stripeCustomerId: string
): Promise<string | null> {
  const sql = getSql()
  const [row] = await sql<{ id: string }[]>`
    select id
    from users
    where stripe_customer_id = ${stripeCustomerId}
    limit 1
  `
  return row?.id ?? null
}

export async function getStripeCustomerId(
  userId: string
): Promise<string | null> {
  const sql = getSql()
  const [row] = await sql<{ stripe_customer_id: string | null }[]>`
    select stripe_customer_id
    from users
    where id = ${userId}
    limit 1
  `
  return row?.stripe_customer_id ?? null
}

export async function setStripeCustomerId(
  userId: string,
  stripeCustomerId: string
): Promise<void> {
  const sql = getSql()
  await sql`
    update users
    set stripe_customer_id = ${stripeCustomerId}, updated_at = now()
    where id = ${userId}
  `
}
