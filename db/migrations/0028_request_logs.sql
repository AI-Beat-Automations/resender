-- migration 0028: bitácora de peticiones para la sección Logs
-- El padre quiere ver, en un solo lugar, las tres piernas del tráfico de una
-- conexión: lo que Meta nos manda (`meta_to_resender`), lo que reenviamos a su
-- webhook (`resender_to_bot`) y lo que su bot le pide a nuestra API de salida
-- (`bot_to_resender`). Lo que ya existía no alcanza: `external_webhook_jobs`
-- guarda el sobre pero no la respuesta del bot ni la duración, el payload crudo
-- de Meta no se persiste en ningún lado, y del envío solo queda
-- `messages.provider_response`.
--
-- Tabla nueva y no un UNION sobre las existentes: filtros, facetas y cursor
-- sobre tres tablas con formas distintas es frágil, y la retención de 30 días
-- no puede tocar `messages` ni los jobs. `external_webhook_jobs` sigue siendo la
-- fuente de verdad del motor de entregas; esto es una **proyección para leer**.
-- Se escribe best-effort: perder una fila acá nunca puede costar un mensaje.
--
-- Sin backfill: la bitácora arranca vacía el día del deploy.
--
-- **Sin FK a `connected_pages`, `client_accounts`, `messages` ni
-- `conversations`**, a propósito: la fila tiene que sobrevivir a la
-- desconexión de la cuenta o al borrado del cliente hasta cumplir sus 30 días
-- —es justo lo que se quiere mirar después de una desconexión—. Por eso el
-- nombre de la cuenta y su id externo van denormalizados. Lo único que la
-- borra antes de tiempo es eliminar al tenant.

create table if not exists request_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,

  direction text not null
    check (direction in ('meta_to_resender', 'resender_to_bot', 'bot_to_resender')),
  -- `skipped` no es un fallo: el entrante llegó bien y no se reenvió a
  -- propósito (sin webhook, pausa de reenvío, cuenta restringida) o era un
  -- reintento de Meta ya procesado. El motivo va en `skip_reason`.
  status text not null
    check (status in ('success', 'failed', 'retrying', 'skipped')),
  channel text not null
    check (channel in ('messenger', 'instagram', 'whatsapp')),
  -- message | postback | echo | status | comment | send | comment_reply |
  -- private_reply. Sin check: un tipo nuevo de Meta no debe tirar el insert.
  event_type text not null,

  method text not null default 'POST',
  -- La ruta nuestra (`/api/meta/send`) o la URL del webhook del tenant.
  endpoint text not null,
  http_status integer,
  duration_ms integer,

  -- Snapshot de la cuenta al momento de escribir (ver cabecera: sin FK).
  connected_page_id uuid,
  client_account_id uuid,
  account_name text,
  account_external_id text,

  -- Correlación. Se guardan desde el día uno porque no se pueden reconstruir.
  event_id text,
  request_id text,
  message_id uuid,
  instagram_comment_id uuid,
  conversation_id uuid,
  provider_message_id text,
  contact_id text,

  -- Solo `resender_to_bot`: la fila es una por entrega y se actualiza en cada
  -- intento. `job_id` es la llave del upsert.
  job_id uuid,
  attempt_count integer not null default 0,
  max_attempts integer,
  next_retry_at timestamptz,
  signed boolean,

  error_code text,
  error_message text,
  skip_reason text,

  -- Texto y no jsonb: van truncados a 64 KB y un JSON truncado no es JSON.
  request_body text,
  response_body text,
  request_truncated boolean not null default false,
  response_truncated boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La lista: «los logs de este tenant, del más nuevo al más viejo», con cursor
-- `(created_at, id)`. Los filtros restantes corren sobre este rango, acotado
-- por el período y por la retención.
create index if not exists request_logs_tenant_cursor_idx
  on request_logs (tenant_id, created_at desc, id desc);

-- Una entrega, una fila: el upsert de cada intento cae acá.
create unique index if not exists request_logs_job_unique
  on request_logs (job_id)
  where job_id is not null;

-- «Ver relacionados»: el mismo mensaje nuestro o el mismo id de Meta.
create index if not exists request_logs_message_idx
  on request_logs (tenant_id, message_id)
  where message_id is not null;
create index if not exists request_logs_provider_message_idx
  on request_logs (tenant_id, provider_message_id)
  where provider_message_id is not null;

-- El barrido de retención del cron.
create index if not exists request_logs_created_at_idx
  on request_logs (created_at);
