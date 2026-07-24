-- Idempotencia del endpoint de salida: header opcional Idempotency-Key.
-- Único por tenant y solo para mensajes salientes.
alter table messages
  add column if not exists idempotency_key text;

create unique index if not exists messages_outbound_idempotency_unique
  on messages(tenant_id, idempotency_key)
  where idempotency_key is not null and direction = 'outbound';
