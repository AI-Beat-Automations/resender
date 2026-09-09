-- migration 0024: se apaga el gate de acceso y se abre Instagram para todos
-- (revierte la 0019 y el default de la 0015)
-- Cualquier cuenta que inicie sesión tiene que poder conectar Messenger e
-- Instagram sin aprobación manual: el permiso por cuenta de la ADR 0010 deja
-- de filtrar y la lista de espera del producto deja de tener gente.
--
-- Dos cosas, no una:
--   1. `users.waitlisted` vuelve a nacer en `false` (como dejó la 0011) y las
--      cuentas que hoy están esperando pasan a `false`. Con eso el layout de
--      producto, /billing y los start/callback/send de los tres canales dejan
--      de morder solos, sin tocar código: el gate sigue cableado y fail-closed,
--      solo que ya no hay nadie del lado cerrado.
--   2. `users.instagram_enabled` nace en `true` y se habilita a todas las
--      cuentas existentes, igual que hizo la 0015 con las de entonces.
--
-- WhatsApp NO se toca: `users.whatsapp_enabled` sigue en `false` por defecto y
-- se aprueba por SQL como antes, porque ese Advanced Access todavía no está.
--
-- Va numerada 0024 porque el 0018 quedó como hueco documentado en la 0019 y
-- el runner ordena por nombre de archivo.

alter table users
  alter column waitlisted set default false;

update users set waitlisted = false;

alter table users
  alter column instagram_enabled set default true;

update users set instagram_enabled = true;
