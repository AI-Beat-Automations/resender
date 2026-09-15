-- migration 0025: pausa de reenvío al webhook, por conexión y por conversación
-- (ADR 0020)
-- Un `timestamptz` nullable y no un booleano: null es «activa» y una fecha es
-- «pausada desde». Con eso la tarjeta puede decir «pausado desde hace 2 h» sin
-- una segunda columna, y no hay forma de que el flag y la fecha se contradigan.
--
-- No se toca `connected_pages.status` a propósito: `status = 'active'` está
-- cableado en todas las lecturas de envío e ingesta, y meter `'paused'` en ese
-- check dejaría la conexión muda y sin poder enviar, que es justo lo que la
-- pausa NO hace. La pausa solo corta el reenvío; la conexión sigue recibiendo,
-- persistiendo, contabilizando y enviando por la API.

alter table connected_pages
  add column if not exists paused_at timestamptz;

alter table conversations
  add column if not exists paused_at timestamptz;

-- La ingesta de comentarios busca «¿hay una conversación pausada con este
-- contacto en esta conexión?». El unique `(connected_page_id, contact_id)` de
-- la 0001 ya cubre esa búsqueda; no hace falta índice nuevo.
