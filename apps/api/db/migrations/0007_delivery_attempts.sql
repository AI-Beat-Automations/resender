-- Reintentos del push al webhook del usuario: cada intento queda registrado
-- como fila propia con su número de intento.
alter table external_webhook_deliveries
  add column if not exists attempt integer not null default 1;
