import type {
  SubscriptionRecord,
  SubscriptionUpsertInput,
} from "../infrastructure/db/repository"

const TERMINAL_STATUSES = ["canceled", "incomplete_expired"]

function isLiveStatus(status: string): boolean {
  return !TERMINAL_STATUSES.includes(status)
}

// Stripe may deliver duplicate and out-of-order snapshots. This mirrors the
// canonical web implementation: a terminal event from an old subscription can
// never replace the tenant's current subscription.
export function shouldApplySubscriptionEvent(
  existing: SubscriptionRecord | null,
  incoming: SubscriptionUpsertInput
): boolean {
  if (!existing || !existing.lastStripeEventAt) return true

  const isNewerOrSame =
    incoming.eventAt.getTime() >= existing.lastStripeEventAt.getTime()
  if (existing.stripeSubscriptionId === incoming.stripeSubscriptionId) {
    return isNewerOrSame
  }

  return isLiveStatus(incoming.status) && isNewerOrSame
}

// When two live subscriptions race, the newer event wins the local row and
// the other live subscription is the only one eligible for cleanup.
export function findSupersededSubscriptionId(
  existing: SubscriptionRecord | null,
  incoming: SubscriptionUpsertInput
): string | null {
  if (!existing) return null
  if (existing.stripeSubscriptionId === incoming.stripeSubscriptionId) {
    return null
  }
  if (!isLiveStatus(existing.status) || !isLiveStatus(incoming.status)) {
    return null
  }

  return shouldApplySubscriptionEvent(existing, incoming)
    ? existing.stripeSubscriptionId
    : incoming.stripeSubscriptionId
}
