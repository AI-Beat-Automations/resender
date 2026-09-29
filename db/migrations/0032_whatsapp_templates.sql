-- migration 0032: la copia local del catálogo de plantillas de WhatsApp (ADR
-- 0024, issue #192)
-- Resender guarda una copia de cada [Plantilla] de las WABAs conectadas: la
-- trae el job `template_sync` al conectar un número y la lee
-- `GET /api/meta/whatsapp/templates`. **La copia no decide qué se envía**:
-- Meta es dueño, y una plantilla que la copia no conoce se envía igual.
--
-- Una fila por `(waba_id, name, language)`. La plantilla es de la WABA y no
-- del número, y una WABA puede tener números de tenants distintos (ver
-- `countActiveWhatsappNumbersInWaba`): por eso no hay `tenant_id` ni
-- `connected_page_id`, y un segundo sync de la misma WABA desde otro número
-- cae sobre las mismas filas. La visibilidad se resuelve al leer, cruzando con
-- los números conectados del actor.
--
-- `status` **sin** check: el catálogo de estados de Meta no es estable
-- (`PENDING`, `IN_REVIEW`, `LIMIT_EXCEEDED`…) y un check haría fallar el sync
-- entero por un estado nuevo. Se guarda lo que manda Meta y se normaliza a
-- `unknown` al leer. `category` sí lo lleva: son tres, y Meta no crea
-- categorías nuevas sin cambiar de versión de API.
--
-- El dueño es la pareja `(created_by_tenant_id, created_by_client_account_id)`
-- de quien la creó desde Resender (ticket 7). Las que trae el sync no tienen
-- dueño y son de solo lectura; el upsert del sync **nunca** toca estas
-- columnas. `on delete set null`: si el dueño se borra, la plantilla sigue
-- existiendo en Meta y se sigue listando, solo que sin dueño.
create table if not exists whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  waba_id text not null,
  name text not null,
  language text not null,
  -- hsm id de Meta: lo único con que se borra UNA versión de idioma.
  meta_template_id text,
  category text check (category is null or category in ('utility','marketing','authentication')),
  status text not null,
  -- Texto del componente BODY con sus {{n}}. Null si Meta no lo trajo.
  body text,
  created_by_tenant_id uuid references users(id) on delete set null,
  created_by_client_account_id uuid references client_accounts(id) on delete set null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (waba_id, name, language)
);
