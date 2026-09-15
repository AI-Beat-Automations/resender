-- migration 0015: permiso de Instagram por cuenta (ADR 0010)
-- Instagram está implementado desde la 0013, pero Meta todavía no concedió el
-- Advanced Access de `instagram_business_manage_messages` e
-- `instagram_business_manage_comments`, así que el canal solo sirve para
-- cuentas propias o de prueba. Esta bandera decide, cuenta por cuenta, si el
-- canal existe para ese tenant:
--   update users set instagram_enabled = true where email = '...';
-- No hay pantalla de administración y nadie se anota en ninguna parte: no es
-- una lista de espera, es un permiso.
--
-- Las cuentas que ya existían quedan habilitadas, igual que hizo la 0004. La
-- consecuencia va sin adornos: el permiso no filtra a ningún cliente actual,
-- solo a los registros posteriores a este deploy. Es deliberado —se prefiere no
-- apagarle el canal a nadie que ya lo tenga andando—, y cerrárselo a un cliente
-- de hoy es un `update` explícito, nunca un efecto del deploy.

alter table users
  add column instagram_enabled boolean not null default false;

update users set instagram_enabled = true;
