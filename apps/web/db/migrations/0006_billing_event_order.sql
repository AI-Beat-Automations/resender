-- migration 0006: order stripe webhook events by event.created
-- `last_stripe_event_at` stores the `created` timestamp of the last applied
-- Stripe event so out-of-order deliveries within the same billing period are
-- detected. Nullable: rows written before this migration accept the next
-- event unconditionally.

alter table subscriptions
  add column last_stripe_event_at timestamptz;
