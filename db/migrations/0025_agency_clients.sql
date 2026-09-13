-- migration 0025: modo agencia (ADR 0020)
-- Una cuenta —el tenant, que sigue siendo `users.id`— puede tener clientes de
-- agencia: un grupo por negocio al que se le asignan conexiones y una persona
-- con acceso acotado a ellas. Nada de lo existente cambia de dueño: el tenant
-- sigue siendo quien paga, tiene las API keys y ve todo.
--
-- Tres tablas y una columna:
--   1. `agency_clients`: el cliente de agencia, siempre dentro de un tenant.
--   2. `agency_client_members`: la persona que entra a ese cliente. Tiene su
--      propia fila de `users` (para autenticarse) pero opera en el tenant de la
--      agencia. Una persona es miembro de un solo cliente (`user_id` es PK) y,
--      en v1, un cliente tiene una sola persona (índice único de abajo: se
--      borra para admitir más sin tocar el esquema).
--   3. `agency_client_invitations`: el enlace de invitación. Solo se guarda el
--      hash del token; el token en claro vive únicamente en el enlace.
--   4. `connected_pages.agency_client_id`: a qué cliente está asignada una
--      conexión. `null` es "sin asignar".
--
-- Las foreign keys a `agency_clients` son compuestas `(agency_client_id,
-- tenant_id)`: la base rechaza asignar una conexión, un miembro o una
-- invitación a un cliente de OTRO tenant, aunque una acción tenga un bug.

create table agency_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create index agency_clients_tenant_idx on agency_clients (tenant_id);

create table agency_client_members (
  user_id uuid primary key references users(id) on delete cascade,
  agency_client_id uuid not null,
  tenant_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (agency_client_id, tenant_id)
    references agency_clients (id, tenant_id) on delete cascade,
  -- El dueño de la cuenta no puede ser miembro de un cliente propio.
  check (user_id <> tenant_id)
);

-- v1: una persona por cliente.
create unique index agency_client_members_one_per_client
  on agency_client_members (agency_client_id);

create index agency_client_members_tenant_idx
  on agency_client_members (tenant_id);

create table agency_client_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  agency_client_id uuid not null,
  -- sha256 en hex del token del enlace.
  token_hash text not null unique,
  -- Opcional: si está, solo la puede aceptar una cuenta con ese correo.
  email text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (agency_client_id, tenant_id)
    references agency_clients (id, tenant_id) on delete cascade
);

create index agency_client_invitations_pending_idx
  on agency_client_invitations (agency_client_id)
  where accepted_at is null and revoked_at is null;

alter table connected_pages
  add column agency_client_id uuid;

-- `set null (agency_client_id)` (Postgres 15+) anula solo la asignación al
-- borrar un cliente: sin la lista de columnas intentaría anular también
-- `tenant_id`, que es not null. La conexión vuelve a "sin asignar" con su
-- historial intacto.
alter table connected_pages
  add constraint connected_pages_agency_client_fk
  foreign key (agency_client_id, tenant_id)
  references agency_clients (id, tenant_id)
  on delete set null (agency_client_id);

create index connected_pages_agency_client_idx
  on connected_pages (tenant_id, agency_client_id);
