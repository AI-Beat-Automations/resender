-- migration 0010: additive schema for the phase-1 API Worker.
-- The legacy web Worker remains live during this phase, so every new column
-- touched only by api is nullable where legacy inserts cannot populate it.

create table if not exists external_webhook_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  tenant_id uuid not null references users(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  webhook_url text,
  payload_version integer not null default 1
    check (payload_version > 0),
  payload jsonb not null,
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'processing',
        'succeeded',
        'failed_permanent',
        'dead'
      )
    ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_status_code integer,
  last_error text,
  recover_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (message_id)
);

alter table external_webhook_deliveries
  add column if not exists job_id uuid
    references external_webhook_jobs(id) on delete cascade,
  add column if not exists event_id text;

alter table connected_pages
  add column if not exists webhook_signing_secret_encrypted text,
  add column if not exists webhook_signing_secret_rotated_at timestamptz;

alter table messages
  add column if not exists idempotency_fingerprint text;

-- A separate reservation closes the provider-call race that a unique index on
-- messages alone cannot close: only the request that inserts the reservation
-- may call Meta. Legacy message rows remain authoritative for old keys.
create table if not exists outbound_idempotency_reservations (
  tenant_id uuid not null references users(id) on delete cascade,
  idempotency_key text not null,
  fingerprint text not null,
  state text not null default 'processing'
    check (state in ('processing', 'completed')),
  message_id uuid references messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);

create index if not exists connected_pages_tenant_cursor_idx
  on connected_pages(tenant_id, updated_at desc, id desc);

create index if not exists conversations_tenant_cursor_idx
  on conversations(tenant_id, last_message_at desc, id desc);

create index if not exists messages_tenant_cursor_idx
  on messages(tenant_id, created_at desc, id desc);

create index if not exists messages_conversation_cursor_idx
  on messages(tenant_id, conversation_id, created_at desc, id desc);

create index if not exists external_webhook_jobs_pending_idx
  on external_webhook_jobs(recover_after asc, id asc)
  where status in ('pending', 'processing');

create index if not exists external_webhook_jobs_tenant_cursor_idx
  on external_webhook_jobs(tenant_id, created_at desc, id desc);

create index if not exists external_webhook_deliveries_job_cursor_idx
  on external_webhook_deliveries(job_id, attempted_at desc, id desc)
  where job_id is not null;
