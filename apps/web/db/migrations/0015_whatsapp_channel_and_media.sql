-- migration 0015: WhatsApp como tercer canal + multimedia
--
-- `connected_pages` gana la identidad de WhatsApp: para este canal
-- `meta_page_id` guarda el phone_number_id (reusa el unique `(channel,
-- meta_page_id)` de 0013) y `waba_id`/`whatsapp_phone_e164` cuentan lo que ese
-- ID no dice. `onboarding_mode` discrimina estándar de Coexistence porque los
-- dos flujos ejecutan pasos distintos contra Meta y el soporte necesita saber
-- cuál corrió. Todas las columnas nuevas son nullable o con default: el worker
-- web legacy sigue insertando sin conocerlas (mismo criterio que 0010).
--
-- El check de `channel` venía inline de 0013, así que Postgres le autogeneró
-- el nombre `connected_pages_channel_check`; se recrea con nombre explícito
-- para que la próxima vez esto sea un drop directo.

alter table connected_pages
  drop constraint if exists connected_pages_channel_check;

alter table connected_pages
  add constraint connected_pages_channel_check
    check (channel in ('messenger', 'instagram', 'whatsapp'));

alter table connected_pages
  add column if not exists waba_id text,
  add column if not exists whatsapp_phone_e164 text,
  add column if not exists onboarding_mode text
    check (onboarding_mode in ('standard', 'coexistence')),
  add column if not exists coexistence_status text,
  add column if not exists history_sync_status text;

-- `messages` deja de ser solo-texto. `text` pasa a nullable porque una
-- ubicación o un sticker no tienen texto y un string inventado haría
-- indistinguible "sin texto" de "texto vacío". `message_type` con default
-- 'text' deja correctas las filas existentes sin backfill.
--
-- `origin` distingue quién produjo el mensaje —cliente, API de Resender, echo
-- de Business App, sync de historia— porque `direction` no alcanza en
-- Coexistence. Queda nullable: las filas legacy lo derivan por `direction` en
-- la proyección y un insert del worker web legacy sigue entrando.
--
-- `delivery_status` es el estado que reporta Meta (sent/delivered/read...),
-- separado del `status` interno; la actualización monotónica (un callback
-- atrasado no rebaja `read` a `sent`) se aplica en el servicio.

alter table messages
  alter column text drop not null,
  add column if not exists message_type text not null default 'text'
    check (message_type in (
      'text', 'image', 'audio', 'video', 'document', 'sticker',
      'contacts', 'location', 'reaction', 'interactive',
      'system', 'order', 'unknown'
    )),
  add column if not exists content jsonb,
  add column if not exists origin text
    check (origin in ('customer', 'resender_api', 'business_app', 'history', 'system')),
  add column if not exists historical boolean not null default false,
  add column if not exists delivery_status text
    check (delivery_status in ('accepted', 'sent', 'delivered', 'read', 'failed', 'deleted')),
  add column if not exists reply_to_meta_message_id text;

-- Dedupe de echoes e historia. El unique de 0001 solo cubre inbound; un echo
-- de Business App o un mensaje importado por la sync son outbound con wamid y
-- Meta los reintenta igual. Scoped por `origin` a propósito: la columna es
-- nueva, así que ninguna fila legacy la tiene y el create no puede fallar por
-- duplicados viejos de Messenger.
create unique index if not exists messages_outbound_provider_id_unique
  on messages (connected_page_id, meta_message_id)
  where meta_message_id is not null
    and direction = 'outbound'
    and origin in ('business_app', 'history');

-- Base del cálculo de la ventana de 24 h: se calcula desde el último mensaje
-- entrante real, no desde `last_message_at` (que mezcla ambas direcciones).
-- El backfill es correcto para la regla "no histórico" porque `historical`
-- nace en esta migración con default false: nada previo es historia.
alter table conversations
  add column if not exists last_inbound_at timestamptz;

update conversations c
  set last_inbound_at = m.max_created
  from (
    select conversation_id, max(created_at) as max_created
    from messages
    where direction = 'inbound'
    group by conversation_id
  ) m
  where m.conversation_id = c.id
    and c.last_inbound_at is null;

-- Adjuntos de mensajes. La autorización vive acá (ownership por tenant), no en
-- R2: el bucket guarda bytes bajo una key no adivinable y esta fila decide
-- quién puede pedirlos. `r2_key` es null hasta que la descarga desde Meta
-- termina; `status` cuenta esa historia (pending → available | failed) y un
-- fallo definitivo no borra el mensaje: queda el adjunto en 'failed' con su
-- error.
create table if not exists message_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  kind text not null
    check (kind in ('image', 'audio', 'video', 'document', 'sticker')),
  provider_media_id text,
  r2_key text unique,
  mime_type text not null,
  filename text,
  caption text,
  size_bytes bigint,
  sha256 text,
  status text not null default 'pending'
    check (status in ('pending', 'available', 'failed', 'deleted')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_attachments_message_idx
  on message_attachments (message_id);

-- (tenant_id, created_at) sirve tanto al listado como al borrado por tenant:
-- la eliminación de cuenta recorre los objetos R2 del tenant desde acá.
create index if not exists message_attachments_tenant_idx
  on message_attachments (tenant_id, created_at desc);

create index if not exists message_attachments_provider_media_idx
  on message_attachments (provider_media_id)
  where provider_media_id is not null;

-- Cargas salientes reservadas por la API pública (POST /v1/media/uploads →
-- PUT content → complete → consumida por un envío). El ciclo de vida es
-- explícito para que la idempotencia del envío pueda exigir "completed y sin
-- mutar": un upload consumido o vencido no puede volver a usarse.
create table if not exists media_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  kind text not null
    check (kind in ('image', 'audio', 'video', 'document', 'sticker')),
  mime_type text not null,
  filename text,
  size_bytes bigint,
  sha256 text,
  r2_key text unique,
  status text not null default 'reserved'
    check (status in ('reserved', 'uploaded', 'completed', 'consumed', 'expired')),
  consumed_by_message_id uuid references messages(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_uploads_tenant_status_idx
  on media_uploads (tenant_id, status);

-- Para el barrido de uploads abandonados (lifecycle del PRD).
create index if not exists media_uploads_expiry_idx
  on media_uploads (expires_at)
  where status in ('reserved', 'uploaded');

-- Descarga durable de media entrante: las URLs que entrega Meta son temporales,
-- así que el webhook solo registra el adjunto pending + este job y responde
-- 200; la Queue hace la descarga con retries. Un job por attachment (unique)
-- para que un retry no cree objetos ni pushes duplicados. La entrega al webhook
-- externo NO necesita tabla nueva: un mensaje de WhatsApp es una fila de
-- `messages` y `external_webhook_jobs` ya lo cubre vía `message_id`.
create table if not exists whatsapp_media_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  attachment_id uuid not null references message_attachments(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed_permanent', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  recover_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attachment_id)
);

-- Espejo de external_webhook_jobs_pending_idx (0010): el cron de recovery
-- levanta lo pendiente en orden.
create index if not exists whatsapp_media_jobs_pending_idx
  on whatsapp_media_jobs (recover_after asc, id asc)
  where status in ('pending', 'processing');
