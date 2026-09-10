-- migration 0020: el esquema que Better Auth necesita (ADR 0014)
--
-- Escalón 1 de 3 del reemplazo de Auth.js por Better Auth. Es **puramente
-- aditiva**: no dropea ni renombra nada, así que se despliega sola sin riesgo y
-- se revierte desplegando el worker anterior sin tocar la base. Al terminar
-- esta migración Auth.js sigue siendo la única autoridad de sesión: estas
-- tablas no las lee nadie todavía.
--
-- Lo que **no** trae, a propósito:
--   - `drop column users.password_hash`: Auth.js todavía la usa. Va en el
--     escalón 2, cuando deje de usarse.
--   - `auth_api_keys`: es del escalón 3, cuando las API keys pasen al plugin.
--
-- El SQL sale de la especificación de columnas de Better Auth traducida al
-- estilo del repo (snake_case, plural, prefijo `auth_`). **No** se corrió
-- `@better-auth/cli migrate`: eso aplicaría por fuera de `_echo_migrations`
-- (`scripts/migrate.mjs`) y dejaría dos cadenas de migración divergentes, que es
-- exactamente lo que `db/migrations/migrations.test.ts` existe para impedir.
--
-- Va numerada 0020 y no 0018 porque el 0018 quedó tomado por otra rama sin
-- mergear y el 0019 ya está aplicado; el runner ordena por nombre de archivo,
-- así que el hueco es inofensivo y el número repetido no lo sería.

-- 1. `users` hace de modelo `user` de Better Auth.
--
-- El `users.id` uuid no se mueve: sigue siendo el tenant y las 13 foreign keys
-- que lo referencian quedan intactas. Solo se le agregan las tres columnas que
-- la librería espera de su modelo `user`, mapeadas después con `modelName` y
-- `fields`.
--
-- Las tres existen porque la librería las pide, no porque el dominio las
-- necesite: `image` queda sin uso hasta que haya un proveedor social, y no hay
-- pantalla para editar `name`. Queda declarado en la ADR 0014.
--
-- `name` nace con default `''` y no nullable porque Better Auth lo trata como
-- requerido; el alta nueva lo pide y a las cuentas existentes se lo pone el
-- script del escalón 2.

alter table users
  add column if not exists name text not null default '',
  add column if not exists email_verified boolean not null default false,
  add column if not exists image text;

-- Las cuentas que ya existían quedan verificadas, con el mismo criterio que la
-- 0004 y la 0015: la columna nace para las altas futuras y no puede degradar a
-- nadie que ya esté operando. No hay canal de correo en el repo, así que una
-- cuenta existente que quedara en `false` no tendría forma de verificarse.
-- El default `false` sigue vigente para toda fila posterior a este deploy.

update users set email_verified = true;

-- 2. `auth_sessions`: la sesión deja de ser un JWT y pasa a ser una fila.
--
-- Es lo que hace posible revocar una sesión desde el servidor, que hoy es
-- imposible. `id` y `token` son text porque los genera Better Auth, no la base;
-- `user_id` es uuid porque el tenant sigue siendo `users.id`.
--
-- `on delete cascade` hacia `users`, coherente con la 0002: borrar un tenant
-- tiene que llevarse sus sesiones.

create table if not exists auth_sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Por `user_id` para listar y revocar las sesiones de una cuenta. Por `token`
-- porque es el lookup de cada request; el unique de arriba ya crea un índice,
-- pero se declara explícito para que el camino de lectura quede escrito.

create index if not exists auth_sessions_user_id_idx on auth_sessions(user_id);
create index if not exists auth_sessions_token_idx on auth_sessions(token);

-- 3. `auth_accounts`: una credencial por proveedor.
--
-- Para el proveedor `credential` guarda el hash de la contraseña; para un
-- proveedor social guarda los tokens de OAuth. `password` es **nullable a
-- propósito**: una cuenta que solo entre por un proveedor social no tiene
-- contraseña, y una fila de OAuth no tiene por qué inventarse una.
--
-- El nombre choca con «Cuenta conectada» del producto, que significa otra cosa
-- —una página de Facebook, una cuenta de Instagram, un número de WhatsApp—. El
-- prefijo `auth_` acota pero no elimina el solapamiento; queda declarado en la
-- ADR 0014.
--
-- `issuer` es **obligatoria** en Better Auth 1.7: es el emisor de la identidad,
-- y junto con `account_id` forma la clave por la que la librería busca una
-- credencial. Para el proveedor local `credential` el valor es literalmente
-- `'local:credential'` (`createLocalAccountIssuer("credential")`), y para un
-- proveedor social sin issuer propio sería `'local:oauth:<provider>'`. Sin esta
-- columna el login no encuentra la credencial: `sign-in/email` filtra por
-- `provider_id = 'credential' and issuer = 'local:credential' and
-- account_id = users.id`, y `updatePassword` / `findCredentialAccount` usan el
-- mismo filtro. No tiene default a propósito: quien inserta una credencial
-- tiene que decir de quién viene.
--
-- El unique autoritativo es `(issuer, account_id)`: es el que la librería
-- declara en su propio esquema y por el que resuelve `findAccountByKey`.
--
-- El unique `(provider_id, account_id)` es el que pedía la especificación del
-- issue #86, anterior a que `issuer` existiera. Se conserva porque hoy no puede
-- rechazar ninguna fila legítima: el único proveedor que existe es
-- `credential`, cuyo mapeo a `local:credential` es 1:1, así que las dos claves
-- separan exactamente las mismas filas. El día que haya un proveedor OIDC con
-- más de un emisor bajo el mismo `provider_id` habría que revisarlo.

create table if not exists auth_accounts (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  account_id text not null,
  issuer text not null,
  provider_id text not null,
  password text,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, account_id),
  unique (issuer, account_id)
);

-- Por `user_id`: la librería lo declara como índice de su modelo `account`, y
-- además el `on delete cascade` de la baja de cuenta hoy haría seq scan.

create index if not exists auth_accounts_user_id_idx on auth_accounts(user_id);

-- 4. `auth_verifications`: lo efímero con vencimiento.
--
-- Es donde cae el handshake de OAuth (`state`, `code_verifier`) y donde caerían
-- los tokens de verificación de email el día que exista un canal de correo.
--
-- **Sin foreign key a `users` a propósito**, y no es un olvido: un `identifier`
-- puede ser un email que todavía no tiene cuenta, o un state de OAuth previo al
-- alta. Atarlo a una fila de `users` haría imposible justamente el caso que la
-- tabla existe para cubrir.

create table if not exists auth_verifications (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_verifications_identifier_idx
  on auth_verifications(identifier);
