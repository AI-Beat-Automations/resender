-- migration 0022: las API keys pasan al plugin `apiKey` de Better Auth (ADR 0014)
--
-- Escalón 3 de 3 del reemplazo de Auth.js por Better Auth. Crea la tabla que el
-- plugin espera; la vieja `api_keys` la dropea la 0023, en este mismo deploy.
--
-- El esquema **no se adivinó**: sale de la definición de tabla que publica el
-- paquete `@better-auth/api-key@1.7.2` (`dist/index.mjs`, `apiKeySchema`), campo
-- por campo, y se traduce al estilo del repo —snake_case, plural, prefijo
-- `auth_`— con el mismo mecanismo que la 0020: `modelName` y `fields` en
-- `lib/auth/auth.ts`. **No** se corrió `@better-auth/cli migrate`: eso aplicaría
-- por fuera de `_echo_migrations` (`scripts/migrate.mjs`) y dejaría dos cadenas
-- de migración divergentes, que es lo que `db/migrations/migrations.test.ts`
-- existe para impedir.
--
-- Cuatro nombres de columna se apartan del calco literal para conservar el
-- vocabulario que ya usan CONTEXT.md, la pantalla de Ajustes y la tabla vieja:
--
--   plugin          columna            por qué
--   ------------    ----------------   -----------------------------------
--   name            label              [API Tokens en Settings] dice `label`
--   start           visible_prefix     el prefijo corto que muestra la lista
--   key             secret_hash        en base solo vive el hash, nunca la key
--   lastRequest     last_used_at       la columna que la lista ya mostraba
--
-- Las keys emitidas **no se migran**: `api_keys.secret_hash` es un HMAC-SHA256
-- irreversible y el secreto en claro nunca se guardó, así que no hay dato del
-- cual derivar el hash nuevo (SHA-256 sin pepper, el del plugin). Se reemiten a
-- mano desde Ajustes. Antes de desplegar hay que anotar cuáles existen:
--
--   select id, label, created_at from api_keys order by created_at;
--
-- porque la 0023 borra la tabla en el mismo deploy y después no queda de dónde
-- sacar la lista de qué reemitir.

create table if not exists auth_api_keys (
  -- `text` y no `uuid`: `advanced.database.generateId` es global y devuelve
  -- `crypto.randomUUID()`, que entra como texto en las tablas `auth_*` (0020).
  -- La columna no tiene default: el id siempre lo pone la librería.
  id text primary key,

  -- Discriminador de configuración del plugin. Hay una sola configuración y por
  -- eso el default `'default'`, que es lo que la librería escribe y lo que su
  -- `configIdMatches` trata como equivalente a null.
  config_id text not null default 'default',

  -- Etiqueta que elige quien la crea. Nullable del lado del plugin; el producto
  -- la exige (`requireName`) y la valida entre 1 y 80 caracteres.
  label text,

  -- Prefijo visible: los primeros 16 caracteres de la key, o sea
  -- `pk_live_` + 8 del secreto. Es exactamente el formato que la tabla vieja
  -- guardaba en `visible_prefix`, así que la lista de Ajustes no cambia.
  visible_prefix text,

  -- El tenant. `uuid` y no `text`: es `users.id`, el mismo uuid que filtran las
  -- cinco rutas de la API externa, y el `on delete cascade` es el de la 0002 —
  -- borrar una cuenta tiene que llevarse sus keys, igual que sus sesiones—.
  -- La `api_keys` vieja era `on delete cascade` desde esa misma migración.
  user_id uuid not null references users(id) on delete cascade,

  -- El prefijo con el que se generó (`pk_live_`), separado del secreto. Lo
  -- guarda el plugin; el producto no lo lee.
  prefix text,

  -- SHA-256 de la key completa, en base64url sin padding. **Sin pepper**: por
  -- eso este PR deja `AUTH_SECRET` y `API_KEY_PEPPER` sin ningún consumidor.
  -- `unique` como en la `api_keys` vieja: dos filas con el mismo hash serían la
  -- misma credencial, y el índice es además el camino de lectura de cada
  -- verificación.
  secret_hash text not null unique,

  -- Recarga periódica de cupo. Fuera de alcance: el producto nunca los escribe
  -- y nacen en null. Existen porque el plugin los declara y su adaptador los
  -- incluye en el INSERT.
  refill_interval integer,
  refill_amount integer,
  last_refill_at timestamptz,

  -- La revocación. El plugin no borra la fila ni tiene columna de estado: apaga
  -- `enabled`, y su `validateApiKey` corta con KEY_DISABLED antes de resolver el
  -- tenant. Es lo que sostiene la regla de CONTEXT.md de que una key revocada
  -- sigue visible en la lista y no desaparece del historial operativo.
  enabled boolean not null default true,

  -- Rate limit por key. Fuera de alcance y **apagado en la configuración**
  -- (`rateLimit: { enabled: false }`), así que las filas nacen con
  -- `rate_limit_enabled = false`. Los dos valores numéricos se guardan igual
  -- porque el plugin los escribe siempre; `integer` alcanza: el default es
  -- 86.400.000 ms, muy por debajo del techo de 2.147.483.647.
  rate_limit_enabled boolean not null default true,
  rate_limit_time_window integer,
  rate_limit_max integer,
  request_count integer not null default 0,

  -- Cupo de usos restantes. Null = sin límite, que es como nacen todas.
  remaining integer,

  -- Última verificación exitosa. Con el rate limit apagado el plugin igual la
  -- refresca en cada `verifyApiKey`, así que es el mismo dato que la lista de
  -- Ajustes mostraba como `last_used_at`.
  last_used_at timestamptz,

  -- Expiración automática. Fuera de alcance: `keyExpiration` viene sin default y
  -- con `disableCustomExpiresTime`, así que siempre es null y la barrida de
  -- expiradas del plugin (`expires_at < now()` **y** `expires_at is not null`)
  -- nunca las alcanza. Las keys viven hasta revocación manual.
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Permisos por key y metadata libre. Fuera de alcance los dos:
  -- `enableMetadata` viene en false y no se configuran permisos, así que
  -- quedan en null. Cada key autentica todo el tenant, como hasta ahora.
  permissions text,
  metadata text
);

-- Los tres índices que el plugin declara (`index: true`). El de `secret_hash` ya
-- lo crea el `unique` de arriba; se declara igual el de lectura por tenant, que
-- es el que sirve a la lista de Ajustes.
create index if not exists auth_api_keys_user_id_idx on auth_api_keys(user_id);
create index if not exists auth_api_keys_config_id_idx on auth_api_keys(config_id);
