-- migration 0027: módulo Clientes (issue #154, ticket #155)
-- Un cliente es un espacio que un padre (tenant con plan Pro o Business) crea
-- para que otra persona conecte sus propias redes con su propio login de Meta.
-- Las conexiones del cliente siguen perteneciendo al tenant del padre: el
-- `tenant_id` de `connected_pages` no cambia, y por eso conversaciones,
-- mensajes, contadores y cuota tampoco. Lo único nuevo en la fila es a qué
-- cliente pertenece (`client_account_id`).
--
-- Tablas propias y no el plugin `organization` de Better Auth: el modelo es
-- «un user es cliente de a lo sumo un padre», y el plugin trae roles, equipos
-- y un esquema que nadie va a usar.

-- 1. `client_accounts`: el espacio del cliente.
--
-- `user_id` nace nulo y se rellena cuando el cliente acepta la invitación (el
-- alta del user es parte del aceptar, que llega en el ticket 2). Es `unique`
-- porque un user es cliente de a lo sumo un padre. `on delete cascade` desde
-- los dos users: borrar al padre se lleva a sus clientes, y borrar al user del
-- cliente se lleva el espacio (el procedimiento de borrado desconecta y borra
-- las conexiones antes, en `lib/clients/client-deletion.ts`).
create table if not exists client_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  user_id uuid unique references users(id) on delete cascade,
  name text not null,
  max_connections integer not null check (max_connections >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_accounts_tenant_id_idx
  on client_accounts (tenant_id);

-- 2. `client_invitations`: un enlace de 7 días por fila.
--
-- Solo el hash SHA-256 del token, nunca el token: la base no puede servir para
-- aceptar una invitación (mismo criterio que `auth_api_keys`). Reenviar crea
-- una fila nueva y marca la anterior como cancelada; aceptar marca
-- `accepted_at`. Una invitación viva es la que no tiene ninguna de las dos
-- fechas y no venció.
create table if not exists client_invitations (
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid not null references client_accounts(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists client_invitations_client_account_id_idx
  on client_invitations (client_account_id);

-- 3. `connected_pages.client_account_id`: nullable, nulo para las conexiones
-- del padre (nada cambia para ellas). `on delete cascade`: borrar un cliente
-- borra sus conexiones, y la 0002 se lleva sus conversaciones y mensajes.
-- Nada vuelve al padre.
alter table connected_pages
  add column if not exists client_account_id uuid
    references client_accounts(id) on delete cascade;

create index if not exists connected_pages_client_account_id_idx
  on connected_pages (client_account_id)
  where client_account_id is not null;
