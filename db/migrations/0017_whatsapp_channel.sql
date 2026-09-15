-- migration 0017: WhatsApp como tercer canal
--
-- Cubre el esquema entero de la fase 1 del canal: el permiso por cuenta, la
-- identidad del número en `connected_pages`, la fuente de la ventana de 24 h,
-- las columnas que WhatsApp le agrega a `messages` y la tabla que sobrevive al
-- borrado de cuenta para poder vaciar R2 después.
--
-- Lo que **no** trae, a propósito: ninguna tabla de adjuntos (un mensaje de
-- Cloud API tiene exactamente un `type`, así que la cardinalidad N no la pide
-- WhatsApp y `messages.attachment_*` de la 0016 alcanza), ninguna tabla de
-- uploads salientes (la media de salida la hospeda el cliente y viaja por
-- `link`, igual que en Messenger) y ninguna tabla de jobs de media (eso es la
-- Queue `whatsapp-jobs`, no Postgres).

-- 1. Permiso por cuenta.
--
-- A diferencia de la 0015, **sin backfill**: allí se habilitó a todas las
-- cuentas existentes porque Instagram ya les funcionaba y el permiso no debía
-- quitarle el canal a nadie. Acá es al revés —WhatsApp no le funciona a nadie
-- todavía—, así que el default `false` es el estado correcto para todos y el
-- canal se abre una cuenta por vez con un update a mano.

alter table users
  add column if not exists whatsapp_enabled boolean not null default false;

-- 2. La identidad del número.
--
-- Para este canal `meta_page_id` guarda el `phone_number_id`, así que el unique
-- `(channel, meta_page_id)` de la 0013 ya da el ownership por número sin tabla
-- nueva. `waba_id` y `whatsapp_phone_e164` cuentan lo que ese id no dice: a qué
-- WABA pertenece y qué número es en formato humano.
--
-- El check de `channel` vino inline en la 0013, así que Postgres le autogeneró
-- el nombre `connected_pages_channel_check`. Se recrea con nombre explícito
-- para que el cuarto canal sea un drop directo y no otra arqueología.

alter table connected_pages
  drop constraint if exists connected_pages_channel_check;

alter table connected_pages
  add constraint connected_pages_channel_check
    check (channel in ('messenger', 'instagram', 'whatsapp'));

alter table connected_pages
  add column if not exists waba_id text,
  add column if not exists whatsapp_phone_e164 text,
  add column if not exists onboarding_mode text
    check (onboarding_mode is null
           or onboarding_mode in ('standard', 'coexistence')),
  add column if not exists coexistence_status text,
  add column if not exists history_sync_status text
    check (history_sync_status is null
           or history_sync_status in (
             'not_requested', 'requested', 'in_progress',
             'complete', 'failed', 'expired'
           ));

-- 3. El PIN de verificación en dos pasos.
--
-- Registrar un número en Cloud API (`POST /{phone_number_id}/register`, solo el
-- flujo estándar) exige un PIN de verificación en dos pasos, y hay dos casos: o
-- el número ya la tenía activada —y el PIN lo aporta el cliente— o no la tenía,
-- y el PIN que mandamos **lo estamos creando nosotros**, activándole de paso la
-- verificación en dos pasos a un número que no la pedía.
--
-- Ese segundo caso obliga a guardarlo. Meta no vuelve a mostrar ese PIN y no hay
-- endpoint para leerlo: si no lo guardamos, el cliente queda con la 2FA activada
-- y un PIN que no conoce nadie, sin poder re-registrar su propio número acá ni
-- en ninguna otra plataforma. Es dato del cliente que custodiamos, no un secreto
-- nuestro, y por eso además de guardarlo hay que poder devolvérselo.
--
-- También es lo que hace posible la reconexión: al relanzar el Embedded Signup
-- sobre un número ya registrado, `/register` vuelve a pedir el PIN vigente —el
-- nuestro—, y sin esta columna la segunda conexión fallaría siempre con 133005
-- pidiéndole al cliente un PIN que inventamos nosotros.
--
-- Cifrado con el mismo aes-256-gcm y la misma `TOKEN_ENCRYPTION_KEY` que
-- `page_access_token_encrypted` (`lib/crypto/encryption.ts`). El sufijo
-- `_encrypted` va en el nombre a propósito: es lo que impide que una consulta de
-- soporte lo seleccione creyendo que es texto plano.
--
-- `whatsapp_pin_generated` dice **de quién** es el PIN, porque cifrados los dos
-- casos se ven igual y solo el nuestro hay que enseñárselo al cliente. `null`
-- significa «no consta» y la aplicación lo trata como «no lo enseñes»
-- (`coalesce(..., false)`): enseñar de más un PIN ajeno es peor que callar uno
-- propio, que además se recupera reconectando.
--
-- El PRD no menciona el PIN. No es una omisión deliberada suya: mantiene
-- `/register` en el flujo A, así que el problema sigue vivo y esto lo cubre.

alter table connected_pages
  add column if not exists whatsapp_pin_encrypted text,
  add column if not exists whatsapp_pin_generated boolean;

-- 4. La fuente de la ventana de 24 h.
--
-- `conversations.last_message_at` no sirve: lo bumpea también el saliente, así
-- que una conversación donde solo contestamos nosotros parecería tener la
-- ventana abierta para siempre. Hace falta la marca del último entrante.
--
-- El backfill es correcto respecto de la regla completa —`direction='inbound'`
-- **y** `historical=false` **y** `origin='customer'`— porque las dos columnas
-- que faltan nacen en esta misma migración: `historical` con default false y
-- `origin` backfilleado abajo a 'customer' para todo entrante existente. Nada
-- previo a esta migración es histórico ni es un echo.

alter table conversations
  add column if not exists last_inbound_at timestamptz;

update conversations c
  set last_inbound_at = m.max_created
  from (
    select conversation_id, max(created_at) as max_created
    from messages
    where direction = 'inbound'
    group by conversation_id
  ) m
  where m.conversation_id = c.id
    and c.last_inbound_at is null;

-- 5. Lo que WhatsApp le agrega a `messages`.
--
-- `attachment_r2_key` + `attachment_status` conviven con `attachment_url` de la
-- 0016: en Messenger e Instagram la URL es del CDN de Meta y no hay copia
-- nuestra, en WhatsApp la URL de descarga dura 5 minutos y la única copia es la
-- de R2. Los cinco estados no son decorativos, significan cosas distintas y la
-- UI los distingue: 'unavailable' es «Meta nunca lo ofreció» (historial de más
-- de 14 días) y 'failed' es «lo intentamos y no se pudo».
--
-- `origin` distingue quién produjo el mensaje, porque en Coexistence
-- `direction` no alcanza: un saliente puede ser nuestro (API) o del negocio
-- escribiendo desde WhatsApp Business App (echo), y solo el segundo hay que
-- reenviarlo sin haberlo enviado.
--
-- `delivery_status` es el estado que reporta Meta, separado del `status`
-- interno; la monotonía (un callback atrasado no rebaja `read` a `sent`) se
-- aplica en el UPDATE, no acá.

alter table messages
  add column if not exists attachment_r2_key text,
  add column if not exists attachment_status text
    check (attachment_status is null
           or attachment_status in (
             'pending', 'available', 'failed', 'deleted', 'unavailable'
           )),
  add column if not exists origin text
    check (origin is null
           or origin in (
             'customer', 'resender_api', 'business_app', 'history', 'system'
           )),
  add column if not exists historical boolean not null default false,
  add column if not exists delivery_status text
    check (delivery_status is null
           or delivery_status in (
             'accepted', 'sent', 'delivered', 'read', 'failed', 'deleted'
           )),
  add column if not exists reply_to_meta_message_id text;

-- `origin` de lo ya persistido. Messenger e Instagram no tienen otra
-- procedencia posible: lo entrante lo escribió una persona, lo saliente lo mandó
-- la API. Sin este backfill el filtro `origin='customer'` de la ventana dejaría
-- mudas todas las conversaciones existentes.

update messages
  set origin = case
    when direction = 'inbound' then 'customer'
    else 'resender_api'
  end
  where origin is null;

-- 6. Un solo discriminador de contenido: `attachment_type`, ampliado.
--
-- La alternativa era `message_type` + `content jsonb`, que dejaría dos
-- discriminadores en la misma fila diciendo lo mismo con distinto vocabulario.
-- Se amplía el catálogo que ya existe. Meta modela la ubicación como adjunto en
-- Messenger, así que tratar 'location' como adjunto no es una licencia nuestra.
--
-- Deuda declarada: «adjunto» pasa a significar «todo lo que no es texto». La
-- entrada [Adjunto] de CONTEXT.md dice «archivo o tarjeta» y queda corta.
--
-- El `document` de WhatsApp entra como 'file', que ya está en el catálogo: son
-- el mismo concepto con dos nombres y agregar el segundo obligaría a mirar los
-- dos en cada rama de la UI.
--
-- Este catálogo es el mismo que `INBOUND_ATTACHMENT_TYPES` en
-- `lib/inbound/inbound-event.ts`. Los dos se tocan juntos o no se tocan.

alter table messages
  drop constraint if exists messages_attachment_type_check;

alter table messages
  add constraint messages_attachment_type_check
    check (
      attachment_type is null
      or attachment_type in (
        'image', 'audio', 'video', 'file', 'sticker', 'reel', 'ig_reel',
        'post', 'ig_post', 'fallback', 'appointment_booking', 'template',
        'unknown',
        'location', 'contacts', 'reaction', 'interactive', 'order', 'system'
      )
    );

-- 7. Dedupe de lo que trae Coexistence.
--
-- El unique de la 0001 solo cubre `direction='inbound'`, pero los echoes de
-- Business App y la mitad saliente del historial llegan como outbound **con**
-- wamid, y Meta los reintenta igual. Índice separado en vez de ampliar el de la
-- 0001 para no cambiarle la semántica al insert de Messenger/Instagram, que hoy
-- depende de que el suyo sea solo-inbound.
--
-- Deuda declarada: quedan dos índices únicos parciales parecidos sobre las
-- mismas dos columnas, y hay que leer los dos para entender la regla completa.
--
-- Scoped por `origin` a propósito: después del backfill de arriba, todo saliente
-- existente quedó en 'resender_api', así que ninguna fila legacy entra en el
-- predicado y el create no puede fallar por duplicados viejos.

create unique index if not exists messages_coexistence_meta_id_unique
  on messages (connected_page_id, meta_message_id)
  where meta_message_id is not null
    and direction = 'outbound'
    and origin in ('business_app', 'history');

-- La cola de descargas pendientes se lee por estado y es diminuta frente a la
-- tabla: índice parcial, no índice sobre toda la columna.

create index if not exists messages_attachment_pending_idx
  on messages (attachment_status)
  where attachment_status = 'pending';

-- 8. El borrado de media que sobrevive al cascade de la 0002.
--
-- El borrado de cuenta es `delete from users` con FKs `on delete cascade`, y en
-- el instante de ese DELETE no queda ninguna fila que recuerde qué hay en R2.
-- R2 tampoco tiene «borrar por prefijo»: hay que listar y borrar de a 1000,
-- decenas de round trips que no caben en un request.
--
-- **Sin FK a `users` a propósito**: es justamente lo único que tiene que
-- sobrevivir al DELETE. Una FK con cascade la borraría con todo lo demás y
-- volveríamos al problema; una con restrict impediría borrar la cuenta.
--
-- Consecuencia que hay que declarar en /privacy y no esconder: al eliminar la
-- cuenta se conserva un identificador interno hasta confirmar el borrado de los
-- archivos, y nunca más de 180 días (la lifecycle rule del bucket es la red).

create table if not exists pending_media_deletions (
  id uuid primary key default gen_random_uuid(),
  r2_prefix text not null unique,
  requested_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text
);
