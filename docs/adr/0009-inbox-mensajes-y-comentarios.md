---
status: accepted
---

# Inbox: una pantalla con dos modos, y los comentarios dejan de ser invisibles

La ADR 0008 mandó los comentarios de Instagram a `instagram_comments`, su propia tabla, y dejó
`conversations`/`messages` solo para DMs. Esa decisión sigue siendo la correcta, pero la
consola nunca construyó el lector del otro lado: `apps/web` escribía comentarios en cada
webhook y no los leía en ninguna pantalla. El único consumo era el push al `webhookUrl` del
tenant, y `GET /v1/comments` vive en `apps/api`, que hoy no tiene service binding desde `web`.

El resultado es que un usuario comentaba en un post, Resender contestaba, y en la consola no
aparecía nada. Ni un vacío que lo explicara: la sección se llamaba `Messages` y no tenía dónde
mostrarlos. La ADR 0005 y el `CONTEXT.md` documentaban el hueco —«los comentarios no tienen
pantalla»— y esta entrega lo cierra.

La decisión es que la sección pase a llamarse **`Inbox`** y tenga dos modos, mensajes y
comentarios, en vez de abrir una pantalla nueva.

## Considered Options

- **Una sección `Comments` aparte, junto a `Inbox` en el sidebar** — rechazado. Serían dos
  entradas de nav para la misma pregunta —«¿qué me escribieron?»— y el usuario tendría que
  saber de antemano por qué superficie le llegó cada cosa. Además duplica la caja de dos
  columnas, el filtro por cuenta y los vacíos.
- **Mezclar comentarios y DMs en una sola lista** — rechazado. Requiere una unión artificial:
  o por `media_id`, que los DMs no tienen, o por `from_ig_id` ↔ `conversations.contact_id`,
  que junta dos hilos que la persona vivió por separado. Es exactamente lo que la 0008 rechazó
  a nivel de datos, reintroducido a nivel de UI.
- **Un modo en `?tab=` sobre la pantalla existente** — elegido. Las dos listas comparten
  geometría, filtro y semántica de burbuja; lo único que cambia es el sujeto de la fila.
- **Log plano de comentarios ordenado por `created_at desc`** — rechazado, aunque
  `instagram_comments_tenant_created_idx` lo habría hecho trivial. Un comentario fuera de su
  publicación no dice nada: se pierde la pregunta a la que contesta cada respuesta, que es
  justamente lo que el usuario abre la pantalla a verificar.
- **Agrupar por comentarista (IGSID)** — rechazado. Se parece más al log de conversaciones,
  pero mezcla en una fila hilos de posts distintos, que es la misma pérdida de contexto.

## Decisiones de dominio

- **La unidad de la lista de comentarios es la publicación**, con clave
  `(connected_page_id, media_id)`. `media_id` solo es único dentro de la cuenta que lo publicó,
  así que la clave de `?media=` es el par: `?media=<connectedPageId>:<mediaId>`.
- **La selección se valida por pertenencia a la lista ya cargada, nunca parseando el
  parámetro.** Se compara el string crudo contra `formatPublicationKey(row)` sobre lo que el
  read model ya devolvió, igual que hoy se valida `?conversation=`. Un `?media=` rancio u
  hostil no llega jamás al SQL y `parsePublicationKey` no necesita existir.
- **`?tab=mensajes|comentarios`, clave en inglés y valores en español**, como
  `/settings?tab=cuenta|api-keys|suscripcion`. El modo por defecto se **omite** de la URL —a
  diferencia de Ajustes, que siempre lo emite— para que `/inbox`, que es lo que enlaza el
  sidebar, sea la URL canónica de la pantalla más visitada.
- **Los enlaces de la pantalla salen todos de `inboxHref`, que filtra la selección por modo.**
  Ningún call site puede emitir `conversation` en comentarios ni `media` en mensajes: un
  parámetro rancio es imposible por construcción, no por limpieza posterior. Cambiar de modo
  conserva el filtro de cuenta y descarta la selección, cayendo en el elemento más reciente del
  modo nuevo.
- **El modo es un enlace, no `Tabs` de Radix** (ADR 0005). Se dibuja con el subrayado de
  `TabsList variant="line"` y no con píldoras a propósito: debajo va el filtro por cuenta, que
  sí son píldoras, y dos filas idénticas no dejarían ver cuál cambia de pantalla y cuál filtra
  la que ya estás viendo. La pantalla entera sigue siendo server component.
- **El filtro de cuentas lista solo Instagram en modo comentarios.** Messenger no tiene
  comentarios. Filtrarlo ahí además invalida solo el `?page=` de una cuenta de Messenger al
  cambiar de modo, sin tener que limpiarlo aparte.
- **La publicación se nombra por su clase y su id**, `reel 17841…`. Meta no manda título ni
  miniatura en el webhook de comentarios: de la publicación solo llegan `media.id` y
  `media_product_type`. El id va entero porque es lo que el usuario cita en soporte.
- **Un comentario y un DM se leen con las mismas burbujas.** Los dos son un ida y vuelta con la
  misma persona; lo que cambia es la cabecera, que nombra la publicación en vez del contacto.
  Instagram anida un solo nivel, así que en vez de dibujar el árbol se nombra al padre en el
  metadato —y solo si está en el hilo cargado; si Meta lo borró, no se inventa nada.
- **El autor de un comentario sí tiene nombre.** A diferencia del DM, donde el contacto es un
  PSID a secas porque `conversations.contact_name` nunca se escribe, Meta manda el `@handle` en
  el webhook de comentarios. Se usa, con `igsid <id>` de reserva.
- **`lib/comments/read-model.ts` es un módulo aparte de `comment-log.ts`**, gemelo del de
  mensajes. El log escribe y devuelve el registro entero —`provider_response` incluido, que
  puede ser un cuerpo de error de Graph completo—; el read model lee los ocho campos que la
  pantalla pinta. `listCommentsForMedia` se borra: era el primero haciendo de segundo y nunca
  llegó a tener call site.
- **El badge de canal entra en el log de mensajes, no en el de comentarios.** En comentarios el
  canal es constante —solo Instagram tiene—, y un badge idéntico en cada fila es ruido.
- **`/messages` sobrevive como 308 a `/inbox`.** Next usa 308 y no 301 para preservar el método,
  y arrastra el query string: un `/messages?conversation=…` compartido sigue abriendo la misma
  conversación.

## Consecuencias

- `CONTEXT.md` §«Estructura de Messages» pasa a §«Estructura de Inbox». Esta ADR **supersede**
  sus dos afirmaciones «`Messages` no muestra badge de canal ni los comentarios» y «los
  comentarios no tienen pantalla».
- La entrada `/messages` de las listas de rutas de producto de las ADR 0005 (§Idioma) y 0006
  queda superseded por `/inbox`. Los cuerpos de esas ADR no se editan: un ADR aceptado es
  registro histórico.
- `Inbox` sigue siendo de solo lectura en los dos modos. El compositor sigue sin existir y las
  respuestas siguen saliendo por la API externa.
- El modo comentarios hace dos consultas por render, igual que mensajes, y **entrar a mensajes
  no consulta `instagram_comments`**: el branch está antes de la lectura.
- La lista de publicaciones no tiene paginación, como tampoco la tenía la de conversaciones. Es
  deuda conocida y compartida: el día que se agregue, se agrega para los dos modos.
