-- migration 0029: el dato de cobro de Meta en los mensajes de WhatsApp
-- (ADR 0023, issue #170)
-- Desde el 1 de octubre de 2026 Meta cobra cada mensaje de servicio entregado
-- pasado el cupo gratis del número. Cada acuse `sent`/`delivered` trae un
-- bloque `pricing` que dice si ese mensaje se cobra; hasta ahora el parser lo
-- tiraba. Se guarda en la fila del mensaje para poder contar el consumo por
-- número y por mes ([Mensaje cobrado por Meta]).
--
-- Las cuatro columnas de texto van **sin CHECK**, a diferencia de
-- `delivery_status` (0017 §5). Meta añade categorías, tipos y modelos de
-- precio sin cambiar de versión de API —el valor de `type` para el cupo gratis
-- de servicio ni siquiera está documentado todavía—, y un CHECK convertiría
-- cada valor nuevo en un UPDATE rechazado: el cobro de ese mensaje se perdería
-- justo cuando más importa contarlo. El valor se guarda tal cual llega y el
-- que cuenta decide qué significa.
--
-- `meta_billed_at` es el momento del acuse `delivered`, que es cuando Meta
-- cobra. Se escribe con cualquier `delivered` que traiga el bloque, cobrable o
-- no: los entregados que no se cobran son los que gastan el cupo gratis, y
-- también se cuentan. Null significa que todavía no llegó ese acuse.
--
-- Todas nullable y sin default: las filas existentes, las de Messenger e
-- Instagram y las entrantes de WhatsApp no tienen dato de cobro, y no lo van a
-- tener nunca.

alter table messages
  add column if not exists meta_billable boolean,
  add column if not exists meta_pricing_category text,
  add column if not exists meta_pricing_type text,
  add column if not exists meta_pricing_model text,
  add column if not exists meta_billed_at timestamptz;

