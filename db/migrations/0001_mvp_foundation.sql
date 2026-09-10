create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists connected_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete restrict,
  meta_page_id text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'disconnected')),
  page_access_token_encrypted text not null,
  webhook_url text,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists connected_pages_tenant_id_idx on connected_pages(tenant_id);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete restrict,
  connected_page_id uuid not null references connected_pages(id) on delete restrict,
  contact_id text not null,
  contact_name text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connected_page_id, contact_id)
);

create index if not exists conversations_tenant_latest_idx on conversations(tenant_id, last_message_at desc);
create index if not exists conversations_page_idx on conversations(connected_page_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete restrict,
  conversation_id uuid not null references conversations(id) on delete restrict,
  connected_page_id uuid not null references connected_pages(id) on delete restrict,
  contact_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null check (status in ('received', 'sent', 'failed')),
  text text not null,
  meta_message_id text,
  error text,
  provider_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx on messages(conversation_id, created_at asc);
create index if not exists messages_tenant_created_idx on messages(tenant_id, created_at desc);
create unique index if not exists messages_inbound_meta_id_unique
  on messages(connected_page_id, meta_message_id)
  where meta_message_id is not null and direction = 'inbound';

create table if not exists external_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  webhook_url text,
  status text not null check (status in ('skipped', 'success', 'failed')),
  status_code integer,
  error text,
  attempted_at timestamptz not null default now()
);

create index if not exists external_webhook_deliveries_message_idx
  on external_webhook_deliveries(message_id);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete restrict,
  label text not null,
  visible_prefix text not null,
  secret_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_tenant_created_idx on api_keys(tenant_id, created_at desc);
