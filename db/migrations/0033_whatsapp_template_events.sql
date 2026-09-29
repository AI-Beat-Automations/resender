-- migration 0033: cambios de estado de plantillas y su evento al tenant (ADR
-- 0024, issue #193)
-- Meta avisa por webhook (`message_template_status_update`) cuando aprueba,
-- rechaza, pausa o deshabilita una [Plantilla]. Resender actualiza su copia
-- (`whatsapp_templates`, 0032) y le manda al webhook del tenant un evento
-- `type: "template"`.
--
-- `whatsapp_template_events` guarda **una fila por cada cambio de estado**, no
-- una por webhook: un webhook repetido con el mismo estado no escribe nada. La
-- fila es el sujeto de las entregas, igual que un mensaje o un comentario, y de
-- su uuid sale el `eventId` determinista del push.
--
-- Como la copia, la fila es de la WABA y no del número: sin `tenant_id`. El
-- `name`, `language`, `status` y `category` se copian de la plantilla en el
-- momento del cambio, porque el evento cuenta lo que pasó entonces y la fila
-- de la plantilla puede volver a cambiar antes de que salga la entrega.
create table if not exists whatsapp_template_events (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references whatsapp_templates(id) on delete cascade,
  waba_id text not null,
  name text not null,
  language text not null,
  status text not null,
  category text,
  -- El motivo de Meta (`INVALID_FORMAT`, `FIRST_PAUSE`…). Null si no dio uno.
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_template_events_template_idx
  on whatsapp_template_events (template_id, created_at desc);

-- El tercer sujeto de las entregas. Mismo patrón que `instagram_comment_id` en
-- la 0013, con una diferencia: un mensaje o un comentario cuelgan de una
-- conexión, y un cambio de estado no —es de la WABA— y se reparte a **cada**
-- conexión activa con webhook de esa WABA. Por eso el sujeto es el par
-- `(template_event_id, connected_page_id)` y la conexión viaja en su propia
-- columna: es la que dice a quién se entrega y con qué secreto se firma.
alter table external_webhook_jobs
  add column if not exists template_event_id uuid
    references whatsapp_template_events(id) on delete cascade,
  add column if not exists connected_page_id uuid
    references connected_pages(id) on delete cascade;

-- Un job por evento y conexión: el reenvío repetido del mismo evento cae acá.
create unique index if not exists external_webhook_jobs_template_event_unique
  on external_webhook_jobs (template_event_id, connected_page_id)
  where template_event_id is not null;

alter table external_webhook_jobs
  drop constraint if exists external_webhook_jobs_subject_chk;
alter table external_webhook_jobs
  add constraint external_webhook_jobs_subject_chk
    check (
      num_nonnulls(message_id, instagram_comment_id, template_event_id) = 1
      and (template_event_id is null or connected_page_id is not null)
    );

alter table external_webhook_deliveries
  add column if not exists template_event_id uuid
    references whatsapp_template_events(id) on delete cascade,
  add column if not exists connected_page_id uuid
    references connected_pages(id) on delete cascade;

create index if not exists external_webhook_deliveries_template_event_idx
  on external_webhook_deliveries (template_event_id)
  where template_event_id is not null;

alter table external_webhook_deliveries
  drop constraint if exists external_webhook_deliveries_subject_chk;
alter table external_webhook_deliveries
  add constraint external_webhook_deliveries_subject_chk
    check (
      num_nonnulls(message_id, instagram_comment_id, template_event_id) = 1
      and (template_event_id is null or connected_page_id is not null)
    );
