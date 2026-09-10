-- migration 0019: se vuelve a encender el gate de acceso (revierte la 0011)
-- La 0011 bajó el default de `users.waitlisted` a `false` porque el registro
-- tenía que quedar abierto (ADR 0007). La decisión se revierte: el acceso
-- vuelve a aprobarse a mano, así que toda cuenta nueva nace en lista de espera.
--
-- Solo hace falta el default. El gate nunca se desmanteló: `createUser` sigue
-- insertando sin nombrar la columna (`lib/auth/users.ts:51`), así que el valor
-- sale de acá, y `resolveProductAccess` / `isUserWaitlisted` siguen cableados
-- en el layout de producto, en /billing y en los start/callback/send de los
-- tres canales. Con el default en `true` esos seis puntos vuelven a morder
-- solos, sin tocar una línea de código.
--
-- NO se toca a los usuarios existentes a propósito: la 0011 los dejó a todos
-- en `false` y son cuentas que ya están operando —varias pagando—. Bloquearlas
-- de golpe sería una caída de producto, no un cambio de política. Para
-- aprobar una cuenta nueva, como antes:
--   update users set waitlisted = false where email = '...';
--
-- Va numerada 0019 y no 0018 porque `feat/whatsapp-templates` ya tiene tomado
-- el 0018 y todavía no mergea; el runner ordena por nombre de archivo y las
-- dos migraciones son independientes, así que el hueco es inofensivo y el
-- número repetido no lo sería.

alter table users
  alter column waitlisted set default true;
