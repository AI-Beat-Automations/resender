-- migration 0014: etiquetas legibles en Inbox
--
-- La pantalla identificaba al contacto por su PSID/IGSID crudo y a la
-- publicación por su `media_id`: dos cadenas de dieciocho dígitos que no le
-- dicen nada a quien las lee. Ninguno de los dos webhooks de Meta trae el dato
-- legible —el de DMs manda `sender.id` a secas, y el de comentarios manda
-- `media.id` sin permalink ni caption—, así que hay que pedirlo a Graph y
-- guardarlo. Estas dos tablas/columnas son ese caché.
--
-- Se resuelve al leer la pantalla y no al ingerir el webhook, a propósito: así
-- las filas que ya existían se completan la primera vez que alguien las mira,
-- que es exactamente cuando importan, y una caída de Graph no puede hacer
-- fallar la recepción de un mensaje.

-- Perfil del contacto. `contact_name` existía desde 0001 y nunca se escribió;
-- ahora sí, junto al @handle. `contact_synced_at` marca el intento, no el
-- éxito: sin él, un contacto que Graph no resuelve —cuenta borrada, token sin
-- permiso— se volvería a pedir en cada render.
alter table conversations
  add column if not exists contact_username text,
  add column if not exists contact_synced_at timestamptz;

-- La publicación es del post, no del comentario: N comentarios comparten
-- permalink y caption. En `instagram_comments` serían N copias del mismo dato y
-- N filas a actualizar cuando cambie, así que va a tabla propia con la misma
-- clave que ordena el hilo, `(connected_page_id, media_id)`.
--
-- No se guarda `thumbnail_url`: la URL del CDN de Meta viene firmada y con
-- vencimiento (`oe=`), así que cachearla es guardar algo que caduca solo.
create table if not exists instagram_media (
  connected_page_id uuid not null references connected_pages(id) on delete cascade,
  media_id text not null,
  -- Null si Graph no lo devolvió: la publicación se borró, o el token perdió el
  -- permiso. La fila se guarda igual para no reintentar en cada render.
  permalink text,
  caption text,
  media_product_type text,
  synced_at timestamptz not null default now(),
  primary key (connected_page_id, media_id)
);
