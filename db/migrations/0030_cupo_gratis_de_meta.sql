-- migration 0030: el consumo del cupo gratis de Meta por número (ADR 0023,
-- issue #171)
-- Cada número de WhatsApp tiene 1.000 mensajes de servicio gratis al mes; los
-- que pasan de ahí Meta se los cobra al cliente ([Cupo gratis de Meta]). La
-- tarjeta de la conexión muestra cuánto lleva del mes, y el dueño recibe un
-- correo al 80 % y al 100 %.
--
-- 1. El índice del conteo.
--
-- La consulta es siempre «mensajes de servicio entregados de estos números en
-- este mes»: `connected_page_id` + rango de `meta_billed_at`, filtrando por
-- `meta_pricing_category = 'service'`. Se cuenta por categoría y no por
-- `meta_billable` porque Meta todavía no documenta cómo marca los del cupo
-- gratis (0029). Parcial por la categoría: las entrantes, Messenger, Instagram
-- y los salientes sin acuse no entran, y son casi toda la tabla. El `include`
-- de `meta_billable` deja el «cuántos se cobraron» dentro del mismo index-only
-- scan, sin ir al heap por cada fila.
--
-- Corre en cada acuse `delivered` de servicio (la alerta), así que no puede ser
-- un scan de `messages`.

create index if not exists messages_meta_service_billed_idx
  on messages (connected_page_id, meta_billed_at)
  include (meta_billable)
  where meta_pricing_category = 'service';

-- 2. `meta_free_tier_alerts`: qué correos del cupo ya salieron.
--
-- Una fila por (número, mes, umbral): la llave primaria es la deduplicación.
-- El correo se reclama con `insert … on conflict do nothing returning`, que es
-- atómico sin transacción interactiva (el driver HTTP de Neon no las tiene):
-- dos acuses concurrentes que cruzan el 80 % a la vez insertan una sola fila y
-- solo uno manda. Si el envío falla, la fila se borra para que el próximo
-- acuse lo reintente.
--
-- `period_start` es el primer instante del mes en UTC, el mismo corte que la
-- tarjeta. `threshold` con CHECK porque, a diferencia de lo que manda Meta,
-- esto lo escribimos nosotros y solo hay dos umbrales.
--
-- `on delete cascade` desde la conexión: sin número no hay a quién avisar, y
-- el borrado de cuenta o de cliente no tiene que pasar por acá.

create table if not exists meta_free_tier_alerts (
  connected_page_id uuid not null
    references connected_pages(id) on delete cascade,
  period_start timestamptz not null,
  threshold smallint not null check (threshold in (80, 100)),
  sent_at timestamptz not null default now(),
  primary key (connected_page_id, period_start, threshold)
);
