-- migration 0034: la lista de espera suma el estimador de WhatsApp como origen
-- (ADR 0007)
-- WhatsApp todavía no está disponible en Resender, así que el cierre de
-- /whatsapp-cost-calculator es el formulario de la lista de espera. Hasta ahora
-- `source` solo aceptaba `landing` y `waitlist_page`, y las altas del estimador
-- quedaban registradas como si vinieran de la landing. `source` sigue
-- registrando la ruta donde se completó el formulario, nunca una campaña.
--
-- El check replica `WAITLIST_SOURCES` de `lib/waitlist/validation.ts`: los dos
-- se tocan juntos o no se tocan.

alter table waitlist_signups
  drop constraint if exists waitlist_signups_source_check;

alter table waitlist_signups
  add constraint waitlist_signups_source_check
    check (source in ('landing', 'waitlist_page', 'whatsapp_cost_calculator'));
