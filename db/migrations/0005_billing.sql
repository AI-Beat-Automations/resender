-- migration 0005: stripe billing (hosted checkout + customer portal)
-- Adds the second access gate after the waitlist: `users.stripe_customer_id`
-- links the account to its Stripe Customer, and `subscriptions` mirrors the
-- Stripe subscription state (one row per tenant, upserted by signed webhooks).
-- Access exists only while `status = 'active'`; see docs/adr/0002.

alter table users
  add column stripe_customer_id text unique;

create table if not exists subscriptions (
  tenant_id uuid primary key references users(id) on delete cascade,
  stripe_subscription_id text unique not null,
  status text not null,
  price_lookup_key text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
