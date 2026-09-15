-- migration 0009: plan entitlements (message quota + page limit)
-- El entitlement deja de ser binario (ADR 0003): cada plan trae una cuota de
-- mensajes por período y un límite de páginas. La ventana de cuota es el
-- período de facturación de Stripe, no el mes calendario, así que hace falta
-- `current_period_start` — la migración 0005 solo guardaba el `end`.
-- El consumo vive en un contador denormalizado por (tenant, período): contar
-- `messages` con `count(*)` pondría un index scan de hasta 100.000 filas en
-- cada envío y cada entrante del hot path.
-- Además (ADR 0004) el user access token de larga duración de Meta pasa a
-- persistirse cifrado por tenant, para poder re-pedir `/me/accounts` en la
-- pantalla de selección de páginas sin repetir el OAuth. Vive en `users` para
-- que el borrado de cuenta se lo lleve sin código extra.

alter table subscriptions
  add column if not exists current_period_start timestamptz;

-- Backfill: sin período conocido el gate es fail-closed, así que una fila vieja
-- quedaría restringida hasta que Stripe mande el evento de la renovación —
-- hasta un mes de bloqueo. Stripe no reenvía eventos solo. El ciclo es mensual
-- (no hay planes anuales), así que restar un mes al `end` reconstruye la
-- ventana; el próximo evento de Stripe la corrige con el valor real.
update subscriptions
set current_period_start = current_period_end - interval '1 month'
where current_period_start is null and current_period_end is not null;

create table if not exists usage_counters (
  tenant_id uuid not null references users(id) on delete cascade,
  period_start timestamptz not null,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period_start)
);

alter table users
  add column if not exists meta_user_access_token_encrypted text;

alter table users
  add column if not exists meta_user_access_token_updated_at timestamptz;
