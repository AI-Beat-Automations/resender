-- migration 0011: apagado del gate de acceso (ADR 0007)
-- El gate de la 0004 se creó para abrir el producto de a poco y aprobar cuentas
-- a mano por SQL. Ya cumplió: el producto está en producción y el registro
-- tiene que quedar abierto. Mientras el default siga en `true`, toda cuenta
-- nueva nace bloqueada (`createUser` inserta sin la columna,
-- `lib/auth/users.ts:45`), y el CTA de la nueva `/waitlist` pública —«registrate
-- ahora si ya te sirve Messenger»— sería mentira: llevaría a /register y la
-- cuenta rebotaría a la pantalla de espera.
--
-- La columna `users.waitlisted` y `lib/auth/waitlist.ts` NO se borran a
-- propósito. `isUserWaitlisted` es fail-closed y vive en el hot path de
-- POST /api/meta/send; con el default en `false` queda inerte, y quitar el
-- código muerto es una entrega aparte, cuando la nueva /waitlist esté estable.
-- Borrarlo en la misma migración obligaría a coordinar el deploy del código con
-- el de la base, que es justo lo que este orden evita.

alter table users
  alter column waitlisted set default false;

update users set waitlisted = false;
