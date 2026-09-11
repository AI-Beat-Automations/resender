-- migration 0013: Instagram como segundo canal (DMs + comentarios)
--
-- `connected_pages` deja de ser "páginas de Facebook" y pasa a ser "cuentas
-- conectadas". El discriminador es `channel`, con default 'messenger' para que
-- las filas existentes queden correctas sin backfill y para que cualquier
-- insert viejo que no conozca la columna siga entrando en el canal correcto.
--
-- Para Instagram, `meta_page_id` guarda el IG user id (el `user_id` que
-- devuelve el OAuth y que llega como `entry.id` en el webhook) y
-- `page_access_token_encrypted` el token de larga duración cifrado con la misma
-- clave que los page tokens de Messenger.
--
-- El `unique` global sobre `meta_page_id` se reemplaza por `(channel,
-- meta_page_id)`: los IDs de página de Facebook y los de cuenta de Instagram
-- viven en namespaces distintos, así que un ID repetido entre canales es
-- legítimo y bloquearlo dejaría a un tenant sin poder conectar su cuenta por
-- una colisión que no significa nada.
--
-- `token_expires_at` es nuevo porque los tokens de Instagram vencen (~60 días)
-- y los page tokens de Messenger no. Queda null en Messenger y es lo que lee el
-- job de refresh.

alter table connected_pages
  add column if not exists channel text not null default 'messenger'
    check (channel in ('messenger', 'instagram')),
  add column if not exists token_expires_at timestamptz,
  -- El @handle de Instagram. `name` sigue siendo el nombre visible; el username
  -- es lo que el usuario reconoce y lo que necesita para identificar la cuenta.
  add column if not exists username text;

alter table connected_pages
  drop constraint if exists connected_pages_meta_page_id_key;

create unique index if not exists connected_pages_channel_account_unique
  on connected_pages (channel, meta_page_id);

-- Los comentarios no son mensajes: cuelgan de una publicación, se anidan entre
-- ellos y su respuesta pública no tiene ventana de 24 horas. Meterlos en
-- `messages` obligaría a media docena de columnas nullable y a una semántica
-- prestada, así que van a tabla propia. `conversations`/`messages` quedan solo
-- para DMs.
create table if not exists instagram_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  connected_page_id uuid not null references connected_pages(id) on delete cascade,
  -- Null en un outbound que Meta rechazó: no hubo comentario, así que no hay id.
  ig_comment_id text,
  -- Null si es un comentario raíz; informado si es respuesta a otro comentario.
  parent_ig_comment_id text,
  media_id text not null,
  media_product_type text,
  -- IGSID de quien comentó. Es la misma identidad que `conversations.contact_id`
  -- usa para los DMs, y por eso alcanza para mandarle la respuesta privada.
  from_ig_id text not null,
  from_username text,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null check (status in ('received', 'sent', 'failed')),
  text text not null,
  error text,
  provider_response jsonb,
  idempotency_key text,
  created_at timestamptz not null default now()
);

-- Dedupe de entrantes en la base y no en la aplicación, igual que
-- `messages_inbound_meta_id_unique` (0001): Meta reintenta el mismo webhook y
-- dos requests concurrentes no se ven entre sí. Parcial porque los outbound
-- fallidos no tienen `ig_comment_id`.
create unique index if not exists instagram_comments_inbound_unique
  on instagram_comments (connected_page_id, ig_comment_id)
  where ig_comment_id is not null and direction = 'inbound';

-- Espejo de `messages_outbound_idempotency_unique` (0008) para el header
-- `Idempotency-Key` de los endpoints de respuesta.
create unique index if not exists instagram_comments_outbound_idempotency_unique
  on instagram_comments (tenant_id, idempotency_key)
  where idempotency_key is not null and direction = 'outbound';

create index if not exists instagram_comments_tenant_created_idx
  on instagram_comments (tenant_id, created_at desc);

-- Los comentarios de una publicación se leen en orden cronológico, no inverso:
-- un hilo se entiende de arriba hacia abajo.
create index if not exists instagram_comments_media_idx
  on instagram_comments (connected_page_id, media_id, created_at asc);

-- La respuesta privada a quien comentó es un DM y se persiste como tal en
-- `messages`. Esta columna guarda el comentario que la originó, que es lo único
-- que la distingue de un DM normal y lo que permite auditar el límite de una
-- sola respuesta privada por comentario.
alter table messages
  add column if not exists instagram_source_comment_id text;

-- Un comentario entrante también se reenvía al webhook del tenant, así que la
-- bitácora de entregas deja de ser exclusiva de `messages`. Se relaja el
-- `not null` y se agrega el sujeto alternativo en vez de crear una segunda
-- tabla de entregas: el consumidor y la política de reintentos son los mismos.
alter table external_webhook_deliveries
  alter column message_id drop not null,
  add column if not exists instagram_comment_id uuid
    references instagram_comments(id) on delete cascade;

-- Exactamente uno de los dos sujetos. Sin esto, relajar el `not null` dejaría
-- entrar filas huérfanas que no se pueden atribuir a nada.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_webhook_deliveries_subject_chk'
  ) then
    alter table external_webhook_deliveries
      add constraint external_webhook_deliveries_subject_chk
        check (num_nonnulls(message_id, instagram_comment_id) = 1);
  end if;
end $$;

create index if not exists external_webhook_deliveries_comment_idx
  on external_webhook_deliveries (instagram_comment_id)
  where instagram_comment_id is not null;

-- Mismo tratamiento en la cola del worker `api`. El `unique (message_id)` de
-- 0010 se parte en dos uniques parciales: con `message_id` nullable, un unique
-- normal permitiría una sola fila con `message_id` null en algunos motores y
-- no expresa lo que queremos, que es un job por sujeto.
alter table external_webhook_jobs
  alter column message_id drop not null,
  add column if not exists instagram_comment_id uuid
    references instagram_comments(id) on delete cascade;

alter table external_webhook_jobs
  drop constraint if exists external_webhook_jobs_message_id_key;

create unique index if not exists external_webhook_jobs_message_unique
  on external_webhook_jobs (message_id)
  where message_id is not null;

create unique index if not exists external_webhook_jobs_comment_unique
  on external_webhook_jobs (instagram_comment_id)
  where instagram_comment_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_webhook_jobs_subject_chk'
  ) then
    alter table external_webhook_jobs
      add constraint external_webhook_jobs_subject_chk
        check (num_nonnulls(message_id, instagram_comment_id) = 1);
  end if;
end $$;
