-- migration 0012: lista de espera pública de captación (ADR 0007)
-- La lista vive en Postgres y no en un proveedor de correo: el formulario es la
-- única escritura anónima del repo y es el momento en que hay alguien esperando
-- adelante, así que una dependencia externa caída se traduciría en registros
-- perdidos. El envío se resolverá cuando exista canal; el dato ya está acá.
--
-- `source` lo escribe el servidor desde un conjunto cerrado, nunca el cliente
-- crudo: registra la ruta donde se completó el formulario (landing o página),
-- no una campaña. No se lee ningún `?ref=`, así que no distingue un evento de
-- otro.
--
-- `heard_from` guarda **claves, nunca etiquetas traducidas**. El formulario es
-- bilingüe: si guardara el label, el mismo canal entraría dos veces según el
-- idioma y el `group by` de atribución dejaría de servir. Los `check` inline
-- replican en la base la whitelist de `lib/waitlist/validation.ts`, para que una
-- ruta futura que inserte sin pasar por ese módulo no ensucie el reparto.
--
-- `unsubscribed_at` se crea desde el inicio aunque todavía no exista canal de
-- correo: se promete baja en el aviso de consentimiento, y tenerla ahora evita
-- una migración el día que el canal exista.
--
-- `consent_at` + `consent_version` dejan registrado qué redacción aceptó cada
-- persona, para no tener que hacer arqueología de commits cuando el aviso
-- cambie.

create table if not exists waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null
    check (source in ('landing', 'waitlist_page')),
  heard_from text not null
    check (
      heard_from in (
        'tiktok',
        'instagram',
        'x',
        'youtube',
        'linkedin',
        'event',
        'other'
      )
    ),
  -- Obligatorio si heard_from = 'other'; lo garantiza `validateWaitlistInput`.
  heard_from_other text null,
  consent_at timestamptz not null,
  consent_version text not null,
  unsubscribed_at timestamptz null,
  created_at timestamptz not null default now()
);

-- Unique sobre `lower(email)` y no sobre `email`: el correo se normaliza en la
-- app, pero el index es la garantía que no depende de que la app lo haga bien.
-- Un segundo envío del mismo correo es un éxito idempotente (no se revela si
-- ya está en la lista) y no pisa la atribución del primero: first-touch.
create unique index if not exists waitlist_signups_email_idx
  on waitlist_signups (lower(email));
