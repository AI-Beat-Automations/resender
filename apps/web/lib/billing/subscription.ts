import { getSql } from "@/lib/db"

// Estado de la suscripción replicado desde Stripe vía webhooks (una fila por
// tenant). El gate lee siempre de esta tabla, nunca de la API de Stripe en el
// hot path. Espejo del patrón de `lib/auth/waitlist.ts`.

export type SubscriptionRow = {
  tenant_id: string
  stripe_subscription_id: string
  status: string
  price_lookup_key: string
  current_period_end: Date | null
  cancel_at_period_end: boolean
}

export type SubscriptionRecord = {
  tenantId: string
  stripeSubscriptionId: string
  status: string
  priceLookupKey: string
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export function mapSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    tenantId: row.tenant_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    priceLookupKey: row.price_lookup_key,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  }
}

type MaybeStatusRow = { status: string } | null | undefined

// Fail closed: solo `active` abre acceso. Fila ausente, cualquier otro status
// (`past_due` incluido, decisión del ADR 0002) o error = sin acceso.
export function hasActiveStatus(row: MaybeStatusRow): boolean {
  return row?.status === "active"
}

export async function hasActiveSubscription(tenantId: string): Promise<boolean> {
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
      current_period_end, cancel_at_period_end
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
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

// Estados en los que una suscripción ya no puede volver a la vida. Una baja
// tardía de una suscripción vieja no debe pisar la fila de una nueva.
const TERMINAL_STATUSES = ["canceled", "incomplete_expired"]

// Decisión pura del upsert (testeable sin DB). Los webhooks de Stripe pueden
// llegar repetidos o fuera de orden y cada evento trae un snapshot completo:
// - misma suscripción: se aplica el snapshot, salvo que traiga un
//   `current_period_end` más viejo que el guardado (evento rezagado de un
//   período anterior);
// - suscripción distinta: reemplaza solo si viene viva; un
//   `customer.subscription.deleted` tardío de la suscripción anterior no debe
//   sobreescribir la suscripción vigente del tenant.
export function shouldApplySubscriptionEvent(
  existing: SubscriptionRecord | null,
  incoming: SubscriptionUpsertInput
): boolean {
  if (!existing) return true

  if (existing.stripeSubscriptionId === incoming.stripeSubscriptionId) {
    if (!existing.currentPeriodEnd || !incoming.currentPeriodEnd) return true
    return (
      incoming.currentPeriodEnd.getTime() >= existing.currentPeriodEnd.getTime()
    )
  }

  return !TERMINAL_STATUSES.includes(incoming.status)
}

// Upsert idempotente por tenant (una fila por tenant, PK = tenant_id). El
// read-decide-write no es atómico, pero el volumen de webhooks es mínimo y
// Stripe reintenta: el último evento válido reconcilia el estado.
export async function upsertSubscription(
  input: SubscriptionUpsertInput
): Promise<void> {
  const existing = await getSubscriptionByTenantId(input.tenantId)
  if (!shouldApplySubscriptionEvent(existing, input)) return

  const sql = getSql()
  await sql`
    insert into subscriptions (
      tenant_id, stripe_subscription_id, status, price_lookup_key,
      current_period_end, cancel_at_period_end
    ) values (
      ${input.tenantId}, ${input.stripeSubscriptionId}, ${input.status},
      ${input.priceLookupKey}, ${input.currentPeriodEnd},
      ${input.cancelAtPeriodEnd}
    )
    on conflict (tenant_id) do update set
      stripe_subscription_id = excluded.stripe_subscription_id,
      status = excluded.status,
      price_lookup_key = excluded.price_lookup_key,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = now()
  `
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
