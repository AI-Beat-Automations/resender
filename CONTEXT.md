# Context

## Canonical Terms

### Auth.js
La autenticación web de Resender en Next.js se implementa con `Auth.js`.
El MVP expone páginas separadas de autenticación: `/login` y `/register`.
Tras `login` o `register`, el usuario aterriza en `/connections` para continuar el onboarding conectando Facebook.
Las rutas protegidas redirigen a `/login` cuando el usuario no esta autenticado.
Si un usuario autenticado entra a `/login` o `/register`, se redirige a `/connections`.

### Landing
La ruta `/` sigue siendo una landing pública simple con la propuesta de valor y accesos a `Login` y `Register`.

### Registro MVP
En el MVP, el registro con email y password deja entrar al usuario inmediatamente. No se exige verificación de email antes de usar la app.

### Gate de acceso (apagado)
Existio un gate de lanzamiento: el registro estaba abierto pero el acceso al producto cerrado por una bandera `users.waitlisted`, con aprobacion manual por SQL. **Ese gate esta apagado** (migracion `0011_disable_access_gate.sql`: `default false` + `update users set waitlisted = false`). Toda cuenta nueva entra directo al producto y el unico filtro que queda es el [Gate de suscripcion].
La columna `users.waitlisted` y `lib/auth/waitlist.ts` siguen en el codigo a proposito: `isUserWaitlisted` es fail-closed y vive en el hot path de `POST /api/meta/send`, asi que con el default en `false` queda inerte y se remueve en una entrega aparte. La pantalla autenticada `/waitlist` se borro; esa ruta ahora es la [Lista de espera].
Decision en `docs/adr/0007-public-waitlist-and-access-gate-shutdown.md`.

### Lista de espera
Lista publica de captacion, sin relacion con el gate anterior. Su unico proposito es guardar el correo de alguien que hoy no puede comprar —porque solo existe Messenger— para avisarle cuando salgan Instagram o WhatsApp. Esta pensada para repartir en conferencias y contactos cara a cara, ademas de la landing.
**No** es una lista de interes por canal: la persona no elige que espera. Deja el correo y recibe los anuncios de producto; el copy promete "updates", no un canal concreto.
Vive en la tabla propia `waitlist_signups` (Postgres, no un proveedor externo), con `unique index` sobre `lower(email)`. La salida es el script `npm run waitlist:export` (CSV): no hay panel de administracion. Hoy no existe canal de correo en el repo, asi que la lista se acumula pero todavia no se puede accionar.
Un correo repetido es un **exito idempotente**: no se inserta nada, la persona ve el mismo mensaje que la primera vez y la atribucion del primer registro queda intacta (first-touch). No se revela si un correo esta en la lista.

### Campos de la lista de espera
El formulario pide dos cosas, y las dos son obligatorias:
- `email`.
- `heard_from`: como conocio Resender. Seleccion **unica** entre `tiktok`, `instagram`, `x`, `youtube`, `linkedin`, `event` y `other`; con `other`, el texto libre `heard_from_other` tambien es obligatorio (~120 caracteres). Se guardan **claves, nunca etiquetas traducidas**: el label rompe el `group by` en un sitio bilingue.

`source` lo escribe el servidor, no el usuario: vale `landing` o `waitlist_page` y registra **la ruta** donde se completo el formulario. No se lee ningun `?ref=`, asi que se distingue landing de pagina pero nunca un evento de otro. `heard_from = 'event'` dice que vino de un evento presencial, jamas de cual.

### Consentimiento de la lista de espera
El checkbox de consentimiento es **bloqueante**: sin marcarlo no se envia, porque una fila sin consentimiento seria una fila a la que no se le puede escribir. Se persisten `consent_at` y `consent_version` para saber que texto acepto cada persona cuando la redaccion cambie.
La columna `unsubscribed_at` existe desde el inicio aunque no haya canal de correo: se promete baja, y el aviso que se mande el dia del lanzamiento va a necesitar un enlace real.
`/privacy` suma un bloque **Waitlist data**. Las dos categorias que declaraba —*Account data* y *Messenger end-user data*— no cubren el correo de alguien que no es cliente guardado para mandarle un anuncio.

### Donde aparece la lista de espera
- **Landing (`/` y `/en`)**: el formulario no es una seccion propia debajo de los precios. Se fusiona en el cierre existente (`FinalCta`), con `Empieza` como accion primaria y el formulario como camino secundario, para no poner la salida gratis entre el precio y el CTA de conversion.
- **`/waitlist` y `/en/waitlist`**: pagina publica con explicacion breve de que es Resender, el formulario, y un CTA de registro para quien ya le sirve Messenger hoy. Es el enlace que se reparte en conferencias.
- Ambas leen su copy del diccionario, incluidas las siete etiquetas de `heard_from` y el texto de consentimiento. `/waitlist` sale de `PRIVATE_PATHS` en `app/robots.ts` y entra al sitemap.

### Proteccion del formulario publico
Es la primera escritura anonima a base de datos del repo: todo lo demas exige sesion, API key opaca o firma HMAC. Tres capas: validacion de formato de correo, campo trampa (honeypot) oculto, y rate limit por IP con el binding nativo `ratelimits` de Cloudflare en el worker de `web`, mismo patron que ya corre en `apps/api`. Cloudflare Turnstile queda descartado por ahora —suma un paso que puede fallarle a un usuario real justo cuando esta delante en un evento— y se agrega si aparece basura real.

### API Token
La integración externa (N8N/IA) no reutiliza la sesión web. Se autentica con una API key opaca separada emitida por Resender para el tenant.

### API Tokens en Settings
Las API keys opacas se crean y gestionan desde `Settings`. En el MVP puede haber múltiples tokens por tenant y cada uno tiene un `label` descriptivo elegido por el usuario.
Los tokens viven hasta revocación manual; no expiran automáticamente en el MVP.
La persistencia de tokens API debe ser con hash, no guardando la credencial completa en texto claro.
El formato visible recomendado es `pk_live_<secretoAleatorio>` o equivalente: un prefijo legible más un secreto aleatorio. En base de datos solo se guarda el hash del secreto.
Para la API externa del MVP no se usan JWTs; la unica credencial aceptada es una API key opaca tipo `Bearer pk_live_<secreto>`.

### Tenant
En el MVP, `tenantId = userId` de nuestra autenticación.

### Usuario MVP
El usuario del MVP tiene un modelo mínimo: `id`, `email`, `passwordHash` y `createdAt`, salvo los campos extra estrictamente necesarios para integrar `Auth.js`.
El registro MVP valida email y exige solo password con longitud minima de 8 caracteres; el cambio de password usa la misma politica minima.
El MVP no incluye recuperacion de password.
El usuario autenticado puede cambiar su password desde `Settings` definiendo un password nuevo; esto no exige conocer el password anterior y no equivale a recuperacion de password. Tras cambiarlo, Resender cierra la sesion actual, lo envia a `login` y le indica que debe iniciar sesion con el password nuevo.
En `login`, los errores son genericos. En `register`, el email duplicado se informa de forma explicita.

### Canal
Resender opera dos canales: `messenger` (páginas de Facebook) e `instagram` (cuentas profesionales de Instagram). El canal es un campo propio, **no** un valor de `provider`: Instagram es Meta —comparten la app, el sobre de error de Graph, la firma del webhook— y lo que cambia es la superficie. `provider` sigue valiendo `"meta"` en los dos.
Toda resolución de una cuenta por su id de Meta exige `channel` de forma **obligatoria y sin default**: los ids de página de Facebook y los de cuenta de Instagram viven en namespaces distintos, y un default convertiría "me olvidé de decidir" en "Messenger" sin que nadie lo note. Decisión en `docs/adr/0008-instagram-como-segundo-canal.md`.

### Cuenta conectada
`connected_pages` dejó de significar "páginas de Facebook" y pasa a significar **cuentas conectadas**: una página de Facebook o una cuenta de Instagram, discriminadas por [Canal]. En Instagram, `meta_page_id` guarda el **IG user id** (el que llega como `entry.id` en el webhook), `username` guarda el @handle y `token_expires_at` la fecha de vencimiento del token (los page tokens de Messenger no vencen; los de Instagram sí, ~60 días).
La unicidad es por `(channel, meta_page_id)`, no global: un mismo id repetido entre canales es legítimo.

### Ownership de páginas
Una página de Facebook conectada pertenece a un solo tenant y no hay transferencia automática de ownership. La regla vale igual para una cuenta de Instagram, y se evalúa **dentro de cada canal**: una cuenta de Instagram homónima de una página de Facebook no bloquea nada.
El ownership se evalúa **página por página**, no sobre la lista completa que devuelve Meta. Que una página ya esté tomada por otro tenant no invalida las demás: si Arturo conectó A y B, y Felipe —que también las administra— quiere conectar C y D, Felipe puede hacerlo. A y B le aparecen en la lista deshabilitadas, con un cartel de que ya están conectadas en otra cuenta. Se muestran en vez de ocultarse para que el usuario entienda por qué le falta una página que sí administra. Decisión en `docs/adr/0004-page-selection-and-per-page-ownership.md`.

### Páginas conectadas por tenant
Cada tenant puede conectar múltiples páginas de Facebook, hasta el límite de su plan (ver [Límites por plan]). El límite cuenta solo las páginas `active` **del canal `messenger`**: las desconectadas no ocupan cupo, pero reconectar una estando en el tope se bloquea igual que conectar una nueva. Las cuentas de Instagram no ocupan cupo (ver [Instagram fuera de facturacion]), y por eso el contador de la UI dice "N de M **páginas de Facebook**" y no "páginas" a secas.
Resender ya no conecta automáticamente todas las páginas que Meta devuelve. Ver [Selección de páginas].
La conexión sigue siendo all-or-nothing **sobre el subconjunto seleccionado**: antes de persistir, Resender verifica que el servidor pueda cifrar tokens y que las páginas sean conectables por ownership local, y exige que Meta confirme la suscripción al webhook de cada página elegida. Si alguna suscripción falla, no se guarda ninguna.

### Selección de páginas
Entre el callback de Meta y la conexión hay una pantalla donde el usuario elige qué páginas conectar, dentro del límite de su plan.
La pantalla **solo agrega**: desmarcar una página ya conectada no la desconecta. Desconectar sigue siendo una acción explícita con confirmación en `Connections` (ver [Gestion de paginas en Connections]), para que el flujo de reconexión no pueda desconectar páginas por accidente.
Para que los page access tokens de las páginas descartadas nunca lleguen a la base, Resender persiste cifrado el **user access token de larga duración** que ya obtiene en el intercambio de OAuth. La pantalla muestra solo `id` y `name`; al confirmar, Resender vuelve a llamar `/me/accounts` con ese token y guarda únicamente los page tokens de las páginas elegidas. Efecto colateral útil: agregar una página más adelante no exige repetir el OAuth de Meta.

### Reconexión de páginas
Si una página ya conectada pertenece al mismo tenant y se vuelve a autorizar en Meta, la reconexión es idempotente: actualiza token, nombre y `updatedAt`.

### Desconexión de páginas
Desconectar una página elimina o desactiva la conexión para futuros envíos y recepciones, pero conserva el historial de conversaciones y mensajes como bitácora.
La baja del webhook en Meta se despacha **por canal**: una cuenta de Instagram se da de baja contra `graph.instagram.com` y no contra el Graph de Facebook. Mandar el token de Instagram al endpoint de Facebook no da un error claro, da un `400` que se registra como "Meta no confirmó" y deja la cuenta recibiendo eventos.

### Conexión de Instagram
Instagram se conecta con **Instagram API con Instagram Login** (`graph.instagram.com`), no con la variante que cuelga de una Página de Facebook: el negocio inicia sesión con su cuenta profesional y no necesita tener ni vincular una Página.
Los permisos van explícitos en el diálogo (`scope`) y no en un `config_id`: `instagram_business_basic`, `instagram_business_manage_messages` e `instagram_business_manage_comments`.
El OAuth **autoriza exactamente una cuenta**, así que no hay pantalla de [Selección de páginas]: el callback persiste directo. El orden es intercambio de código → perfil → suscripción al webhook → persistencia; una cuenta guardada que no recibe eventos se ve conectada y está muda, mientras que una suscripción sin fila en la base no le hace nada a nadie.
El token de larga duración de Instagram vence a los ~60 días y se guarda su `token_expires_at`. **Todavía no hay job de refresh**: es deuda conocida, no una decisión.

### Webhook de Instagram
Instagram tiene **ruta y secreto propios**, separados de los de Messenger: `INSTAGRAM_APP_SECRET` no es `META_APP_SECRET`. Compartir la ruta obligaría a adivinar con cuál secreto verificar cada payload. Cada webhook se registra por separado en el panel de Meta, con su propio verify token, suscrito a los campos `messages` y `comments`.
Rutas: `/api/meta/instagram/webhook` en `apps/web` y `/webhooks/meta/instagram` en `apps/api`. El resto —verificación HMAC sobre el body crudo, dedupe por índice único, resolución cuenta→tenant, gates, bitácora de entregas y política de reintentos— es el mismo que el de Messenger.

### DM de Instagram
Los mensajes directos de Instagram usan las mismas tablas `conversations` y `messages` que Messenger; el canal se deriva de la cuenta conectada. El contacto se identifica por su **IGSID**, igual que el PSID en Messenger.
Dos eventos se descartan y no se persisten: `is_echo` —los mensajes que manda la propia cuenta vuelven como evento entrante, y sin filtrarlos el sistema se responde a sí mismo en bucle— y `is_deleted`, que es un envío que el usuario deshizo y no un mensaje nuevo.

### Comentario de Instagram
Los comentarios viven en su **tabla propia** `instagram_comments`; `conversations`/`messages` quedan solo para DMs. Un comentario cuelga de una publicación (`mediaId`), se anida en un hilo (`parentIgCommentId`) y su respuesta pública no tiene ventana de 24 horas: meterlo en `messages` habría pedido media docena de columnas nullable y una semántica prestada.
Un comentario entrante se persiste y se reenvía al `webhookUrl` del tenant igual que un mensaje, y comparte con él la bitácora `external_webhook_deliveries`, que desde la migración `0013` acepta **un mensaje o un comentario**, exactamente uno de los dos.
Los comentarios que publica el propio Resender vuelven por el webhook y se descartan con **tres** señales, porque en comentarios no existe `is_echo`: que el autor sea la propia cuenta (`from.id === entry.id`), que el @handle coincida con el de la cuenta conectada, y —la única que no depende del `from` que manda Meta— que ese id de comentario sea de una fila `outbound` nuestra.

### Respuesta a un comentario
Son **dos** operaciones distintas y Meta las trata como tales:
- **Respuesta pública**: se publica debajo de la publicación, no tiene ventana, se pueden mandar las que se quieran y se persiste en `instagram_comments`.
- **Respuesta privada**: es un **DM** a quien comentó, se persiste en `messages` con `instagram_source_comment_id`, tiene una ventana de **7 días** desde el comentario y Meta admite **una sola por comentario**. Es la única forma de escribirle primero a alguien que nunca mandó un DM.
El destinatario **no lo elige el cliente**: el body es `{ pageId, commentId, reply }` y no acepta `recipientId`. En la respuesta privada el IGSID sale del comentario guardado; aceptarlo del cliente habría dejado mandarle un DM a cualquiera amparándose en un comentario ajeno.
`commentId` es el id **de Meta** y no el uuid de Resender: es el que el tenant siempre tiene, porque le llegó en el push y además lo ve en Instagram. Se exige que el comentario esté en la bitácora; si no está, es `404`.
El límite de una respuesta privada se verifica **contra nuestra propia base antes de llamar a Meta** y se devuelve como `409` con el id del mensaje que ya salió. Meta lo rechaza con un `100/2534025` que junta cuatro causas —pasaron 7 días, ya contestamos, borraron el comentario, esa persona no acepta mensajes— y no dice cuál. Solo cuentan los envíos que Meta aceptó: un intento fallido no consume la única respuesta disponible.

### Límite de texto por superficie
Tres superficies, tres límites, y dos unidades distintas:
| Superficie | Límite |
|---|---|
| Mensaje de Messenger | 2000 caracteres |
| DM de Instagram | **1000 bytes UTF-8** |
| Comentario de Instagram | **2200 caracteres** (code points) |
Se validan antes de llamar a Meta y el `400` dice el número exacto, porque el rechazo de Meta no dice cuánto sobró. La unidad importa: en español cada acento son 2 bytes y cada emoji 4, así que 501 "ñ" son 1002 bytes y un control por `length` los dejaría pasar; al revés, un comentario de 1200 emojis son 1200 caracteres que Instagram acepta y que `length` rechazaría.

### Traduccion de errores de Meta
Resender traduce el sobre de error de Graph a un mensaje accionable. Hay **tres catálogos** —Messenger, DM de Instagram y comentario de Instagram— y no uno solo: los códigos coinciden pero lo que el usuario tiene que hacer es distinto, y ese es el punto entero de traducir un error. Un `10` es la ventana de 24 h en un DM y un permiso faltante en una respuesta pública, que no tiene ventana; un `190` es "revocaron permisos, reconectá la Página" en Messenger y "el token venció solo, reconectá la cuenta" en Instagram.
Los tres motivos que no dependen de qué se estaba enviando —token vencido, rate limit, bloqueo por política— viven una sola vez y se comparten, para que no se separen con el tiempo.

### Instagram fuera de facturacion
Por ahora Instagram **no consume [Mensaje contabilizado] ni ocupa cupo de páginas**. Sus entrantes no incrementan el contador del período y no se frenan cuando el tenant queda [Cuenta restringida] por su consumo de Messenger; sus salientes tampoco suman.
El [Gate de suscripcion] **sí aplica**: sin suscripción activa no se conecta, no se envía y los entrantes se descartan sin persistir, igual que en Messenger.
Es una decisión provisional —los planes publicados hablan de páginas de Facebook— y el punto exacto donde vuelve el entitlement está marcado con un comentario en cada ruta de envío de Instagram.

### Entrega de entrantes al sistema externo
El MVP usa `push`: tras persistir un mensaje entrante, Resender lo reenvía de forma no bloqueante al sistema externo del tenant.
La URL de destino externo se configura por página. Si una página no tiene `webhookUrl`, el mensaje entrante se persiste igual y aparece en la bitácora, pero no se reenvía.
La `webhookUrl` debe usar HTTPS para destinos reales; HTTP queda reservado a desarrollo local.
El payload reenviado al sistema externo incluye contexto minimo pero rico de `tenant`, `page`, `conversation` y `message`.
Un tenant recibe **mensajes y comentarios en el mismo endpoint**, así que el payload abre con un discriminador `type: "message" | "comment"`; el segundo trae `comment` en lugar de `conversation` + `message`. Y `page` lleva siempre `channel` y `username` —`username` va `null` en Messenger—, porque un tenant con los dos canales apuntando al mismo webhook necesita distinguir de cuál vino el evento y una forma uniforme se consume más fácil que una que cambia según el canal. Los tres campos son **aditivos**: no rompen a los consumidores existentes.

### API externa de salida
La API externa de salida usa API key opaca por header `Authorization: Bearer ...`.
`POST /api/meta/send` recibe `pageId`, `recipientId`, `reply` y puede recibir `conversationId` opcional para facilitar persistencia y auditoria del mensaje saliente.
Si `conversationId` viene informado, debe coincidir con `pageId` y `recipientId`; si no coincide, la request se rechaza con `400`.
Los mensajes salientes se persisten tanto en exito como en fallo, usando `status` para distinguir el resultado del envio.
Instagram no agrega un campo `channel` al endpoint de Messenger: usa **rutas propias**, que son las de Facebook con `/instagram` insertado. En `apps/web`: `POST /api/meta/instagram/send` (DM, mismo body que Messenger, donde `pageId` es el IG id de la cuenta), `POST /api/meta/instagram/comments/reply` (respuesta pública) y `POST /api/meta/instagram/comments/private-reply` (DM al que comentó). En `apps/api`: `POST /v1/comments/{commentId}/replies` y `POST /v1/comments/{commentId}/private-replies`, donde `{commentId}` sí es el uuid de Resender porque el resto de la API v1 se direcciona por uuid propio.
Las tres rutas de salida de Instagram comparten la API key del tenant, el header `Idempotency-Key` y la persistencia en éxito y en fallo. En `apps/api`, las respuestas a comentarios **comparten cubeta de rate limit** con el envío de mensajes: son la misma clase de operación —salir hacia Graph por cada evento entrante— y con cubetas separadas un tenant podría duplicar su presión sobre Meta sin tocar su límite.

### Semantica visual de Inbox
En la bitacora, el color principal representa direccion: entrante verde y saliente amarillo. Si un saliente falla, conserva el amarillo pero muestra un indicador de error por estado. Vale igual para un DM y para una respuesta publica a un comentario: los dos son un ida y vuelta con la misma persona y se leen con las mismas burbujas.

### Estructura de Inbox
La seccion se llama `Inbox` y vive en `/inbox`. `/messages` sigue respondiendo con un 308 hacia ella, arrastrando el query string. Tiene **dos modos** en `?tab=`: `mensajes` (el de por defecto, que se omite de la URL) y `comentarios`. El modo es un enlace, no estado de React, y por eso la pantalla entera sigue siendo server component.

En **mensajes**, `Inbox` se organiza como lista de conversaciones mas vista de hilo. Cada conversacion corresponde a una cuenta conectada y un contacto.
Las conversaciones se ordenan por `lastMessageAt desc` y, al entrar, se abre automaticamente la conversacion mas reciente.
Cuando un tenant tiene multiples cuentas conectadas, `Inbox` muestra por defecto conversaciones de todas, con un filtro visible por cuenta.
El contacto se identifica por su **@handle**. Ninguno de los dos webhooks lo trae —el de DMs manda `sender.id` a secas— asi que se pide a Graph y se cachea en `conversations.contact_username` / `contact_name` (migracion 0014). El PSID/IGSID crudo queda de caida: en Messenger no hay perfil que pedir, y en Instagram Graph puede no resolver el contacto.
Cada fila y la cabecera del hilo llevan **badge de canal**: con Messenger e Instagram en el mismo log, dos filas de cuentas distintas solo se distinguian por el id. La cuenta de Instagram se identifica por `@handle · ig_id`, igual que en `Connections`. La respuesta privada a un comentario es un DM como cualquier otro y aparece en su conversacion; lo unico que la distingue es el sufijo `· respuesta a comentario` en el metadato de la burbuja, que sale de `messages.instagram_source_comment_id`.

En **comentarios**, la unidad de la lista es la **publicacion**, no el comentario suelto ni el contacto: un comentario cuelga de un post y fuera de ese hilo no significa nada. Cada fila muestra el ultimo comentario, el caption de la publicacion y el total; el panel derecho lista los comentarios de esa publicacion en orden cronologico ascendente, entrantes y respuestas publicas, incluidas las que Meta rechazo. La seleccion vive en `?media=<connectedPageId>:<mediaId>`, el par y no el `media_id` solo porque un id de Meta solo es unico dentro de la cuenta que lo publico. El filtro de cuentas lista **solo Instagram** en este modo: Messenger no tiene comentarios y una pildora que siempre devuelve cero es un control muerto.

El webhook de comentarios solo trae `media.id` y `media_product_type`, asi que el **caption y el permalink** se piden a Graph y se cachean en `instagram_media` (migracion 0014). La cabecera del hilo enlaza al post en Instagram: como no hay compositor, abrir el post es lo que el usuario necesita para contestar de verdad. Mientras no esten resueltos —o si Meta no los devuelve— la publicacion se nombra por su clase y su id, que es lo que se cita en soporte.

Las dos resoluciones —@handle y publicacion— corren al **leer la pantalla**, no al ingerir el webhook: asi las filas que ya existian se completan la primera vez que alguien las mira, y una caida de Graph no puede hacer fallar la recepcion de un mensaje. El intento se sella aunque falle, para no volver a pedir lo mismo en cada render.

Los dos modos son de **solo lectura**: no hay compositor en ninguno, las respuestas salen por la API externa. Decision en `docs/adr/0009-inbox-mensajes-y-comentarios.md`.

### Pantallas de configuracion
La gestion de paginas conectadas no vive dentro de `Settings` en el MVP; se realiza en una pantalla separada.
La pantalla separada se llama `Connections` y vive en la ruta `/connections`.
`Settings` queda limitado a cuenta y API keys en el MVP.

### Gestion de paginas en Connections
`Connections` es la pantalla operativa de Meta. Cada pagina conectada puede mostrar y editar su `webhookUrl`, ademas de desconectarse.
Los dos canales conviven en la misma lista. El **badge de canal va primero** en cada tarjeta: con dos canales mezclados es el dato que ordena todo lo demas. Instagram muestra `@handle · ig_id` y Messenger sigue mostrando `page_id`. El boton "Conectar Instagram" es secundario (`outline`) junto al de Facebook: dos primarios lado a lado no dicen cual es el camino habitual.
La `webhookUrl` se guarda con accion explicita mediante boton `Guardar`.
Desconectar una pagina requiere confirmacion explicita y debe advertir que se conserva el historial.

### Gestion de API keys en Settings
Cada API key tiene `label` y su valor secreto se muestra una sola vez al momento de crearla; despues solo queda visible su metadata no secreta.
La lista de API keys muestra `label`, prefijo visible corto, `createdAt`, `lastUsedAt` y estado.
Una API key revocada sigue visible en la lista con estado `revoked`; deja de autenticar, pero no desaparece del historial operativo.
Cada API key del MVP autentica acceso a todas las paginas del tenant; no existen restricciones por pagina en esta version.

### Cuenta de revision
Para Meta App Review, Resender usa una cuenta de revision preconfigurada en lugar de pedirle al revisor que haga onboarding desde cero. Esta cuenta representa un tenant de Resender y debe tener una pagina de Facebook de prueba ya conectada, una `webhookUrl` configurada y una automatizacion demo activa que responda por la API externa de salida. Las credenciales compartidas con Meta son solo de Resender; no se comparten credenciales personales de Meta/Facebook.

### Page de revision
La Page de revision es la pagina de Facebook conectada dentro de la cuenta de revision. Los mensajes no llegan al usuario de Resender directamente: llegan a esta Page, Resender los persiste en la bitacora y los reenvia al sistema externo configurado. El revisor debe poder enviar un DM a esta Page y ver en Resender que aparece la conversacion, junto con la respuesta enviada de vuelta por Messenger.

### Usuario Messenger de prueba
El Usuario Messenger de prueba es una cuenta de Facebook controlada por AI Beat/Resender que se usa para grabar el screencast y enviar DMs a la Page de revision mientras la app esta en modo Development o pendiente de aprobacion. Esta cuenta debe tener el rol/relacion necesaria en Meta para que sus mensajes lleguen al webhook antes de que `pages_messaging` este aprobado en Live. No se comparten credenciales personales de Facebook/Messenger con Meta; al revisor se le entrega la cuenta de revision de Resender y pasos claros.

### Automatizacion demo
La automatizacion demo es el sistema externo conectado al `webhookUrl` de la Page de revision. Su objetivo no es cambiar el modelo de producto ni convertir Resender en bot, sino demostrar durante App Review que el flujo completo de `pages_messaging` funciona: DM entrante, persistencia, push externo, respuesta por `/api/meta/send` y recepcion del mensaje en Messenger.

### Identidad legal
La entidad que opera Resender es **AI Beat**. `Resender` es el nombre del producto; `AI Beat` es la empresa responsable que figura en los documentos legales (politica de privacidad, terminos).

### Responsable y Encargado (roles de privacidad)
Resender trata dos clases de datos con roles distintos. Para los datos de la cuenta/`tenant` (los clientes de Resender), **AI Beat es el responsable**. Para los mensajes de usuarios de Messenger que escriben a las paginas de los tenants, **AI Beat actua como encargado/procesador en nombre del tenant**, que es el responsable de esas conversaciones. Este reparto determina que las obligaciones de cara al end-user recaen sobre el tenant, no sobre AI Beat.

### Postura de cumplimiento
La politica de privacidad adopta una linea base pragmatica para clientes de USA y Latinoamerica: lenguaje claro, derechos genericos del titular (acceso, correccion, eliminacion, opt-out) sin comprometerse con un regimen especifico (GDPR/LGPD). Queda "GDPR-ready" para anadir secciones si en el futuro entran clientes europeos.

### Contacto legal y de seguridad
El correo publico unico para privacidad, solicitudes de eliminacion de datos y reporte de vulnerabilidades es `info@resender.dev`. Debe ser un buzon real y monitoreado.

### Terminos de servicio
La pagina publica `/terms` contiene los Terminos de Servicio de Resender para tenants. Debe dejar claro que el tenant es responsable de sus Pages, automatizaciones externas, contenido de mensajes, cumplimiento de politicas de Meta, consentimiento de usuarios y uso aceptable. Esta pagina complementa `/privacy` y `/data-deletion` como artefacto legal para App Review.

### Metodo de eliminacion de datos
Resender NO usa el Data Deletion Callback de Meta (el `signed_request` trae un FB `user_id` que no mapea a nada: el OAuth nunca guarda el FB user_id del que conecta). En su lugar, el campo "Data Deletion" del panel apunta a una **Data Deletion Instructions URL**: una pagina publica `/data-deletion` que explica como borrar los datos. El borrado real ocurre por dos canales: el boton self-serve en `Settings` y el correo `info@resender.dev` (≤30 dias).

### Configuracion de revision Meta
Para el envio actual a Meta App Review, Resender solicita solo permisos de Messenger: `pages_messaging`, `pages_manage_metadata` y `pages_show_list`. No se solicitan permisos de Instagram, WhatsApp, Business Management ni otros permisos extra en esta revision.
El canal de Instagram **no altera este envio**: se desarrollo contra una app de Meta separada ("Resender.dev - Test1") y necesita su propia revision de `instagram_business_manage_messages` e `instagram_business_manage_comments` (Advanced Access + verificacion de negocio) antes de servir cuentas de terceros. Hasta entonces solo funciona con cuentas propias o de prueba en Standard Access.
Los permisos viven en el `config_id` de Facebook Login for Business, no en codigo. El `config_id` usado para esta revision es nuevo y dedicado a este envio de Messenger; quedo configurado solo con `pages_manage_metadata`, `pages_messaging` y `pages_show_list`. En particular, `business_management` queda fuera del alcance de Messenger porque Resender no administra Business Manager, WABAs, cuentas publicitarias ni assets de negocio en este flujo. El panel de Meta debe mantenerse alineado con el alcance real del producto: listar paginas autorizadas, suscribir/desuscribir paginas al webhook y enviar/responder mensajes de Messenger.
El dominio canonico para el envio es `resender.dev`. Las URLs publicas que deben cargarse en Meta Dashboard son `https://resender.dev/privacy` como Privacy Policy URL y `https://resender.dev/data-deletion` como Data Deletion Instructions URL.

### Documentacion publica del flujo (`/docs`)
La pagina publica `/docs` documenta, en ingles y para developers externos, el flujo de integracion en 3 pasos. Vocabulario canonico en ingles (alineado con el modelo existente):
- **Channel** = pagina de Facebook conectada (ver [Gestion de paginas en Connections]). ⚠️ Este uso **colisiona** con el [Canal] del modelo de datos, donde `channel` vale `messenger` o `instagram`. Al reescribir `/docs` —que ya no vive en este repo— la cuenta conectada debe dejar de llamarse "channel".
- **Inbound message** = mensaje del cliente que Resender hace push al `webhookUrl` del developer (ver [Entrega de entrantes al sistema externo]). Tiene `direction: "inbound"`, `status: "received"`. NO se llama "response"/"respuesta".
- **Reply** = respuesta del developer al cliente via `POST /api/meta/send` (ver [API externa de salida]).
Resuelto: en el spec original "respuesta" apuntaba al mensaje que llega al webhook; eso es un **inbound message**, no una response. La unica "response" es el **reply** que sale por el endpoint.
Gotcha documentado: el campo `pageId` de `POST /api/meta/send` se matchea contra `meta_page_id`, asi que el developer debe pasar el `page.metaPageId` del payload entrante (no el `page.id` interno). `recipientId` = el `conversation.contactId` del payload entrante.

### Borrado de cuenta (account deletion)
"Delete account" en `Settings` borra **todo** el tenant (cuenta, paginas, conversaciones, mensajes, API keys); no hay borrado parcial en el MVP. Es inmediato y transaccional en produccion; los backups se purgan en ≤30 dias. Antes de borrar, se intenta best-effort dar de baja cada pagina activa del webhook de Meta. Requiere confirmacion destructiva (reescribir el email de la cuenta). Se implementa con FKs `on delete cascade` (migracion `0002`), que reemplazan el `on delete restrict` original. Cuidado: con cascade, borrar una fila de `connected_pages` arrastraria su historial; hoy nada borra paginas (ver [Desconexión de páginas], que es UPDATE no DELETE).

### Suscripcion (billing)
El uso del producto requiere una suscripcion de pago gestionada por Stripe. Hay 2 planes mensuales en USD: **Starter $15** y **Pro $25**. Solo ciclo mensual.
El plan **Business $60** fue eliminado: su price esta archivado en Stripe y nunca tuvo suscripciones. El ADR 0002 y las versiones anteriores de esta seccion hablaban de 3 planes; quedan enmendados.
La diferenciacion funcional entre planes ya no es binaria: cada plan trae una cuota de mensajes y un limite de paginas. Ver [Límites por plan]. Decisiones en `docs/adr/0002-stripe-checkout-subscriptions.md` y `docs/adr/0003-plan-entitlements-usage-quota.md`.

### Límites por plan
| Plan | Precio | Mensajes por período | Páginas |
|---|---|---|---|
| `starter_monthly` | $15 | 50.000 | 2 |
| `pro_monthly` | $25 | 100.000 | 5 |

El límite se resuelve desde `subscriptions.price_lookup_key` contra un mapa en código. Un `price_lookup_key` desconocido es fail-closed, igual que el resto de los gates.

### Mensaje contabilizado
La cuota mide **ambas direcciones**: cada [Inbound message] persistido suma 1, y cada reply que Meta acepta (`status: 'sent'`) suma 1. Una conversación de ida y vuelta consume 2 unidades, así que los 50.000 del Starter son ~25.000 intercambios; los números publicados se mantienen sabiendo esto.
**No** consumen cuota: un envío que Meta rechaza (`status: 'failed'`) —el cliente no paga por un page token vencido nuestro ni por la ventana de 24h de Messenger— ni un replay idempotente, que no llama a Meta ni inserta mensaje nuevo.
Los entrantes **cuentan aunque no se entreguen**: si el tenant está restringido o la página no tiene `webhookUrl`, el mensaje se persiste igual y consume cuota. Lo que la cuota cubre es recibir y persistir, no entregar.
La cuota mide **solo el canal `messenger`**: ver [Instagram fuera de facturacion].

### Período de cuota
La ventana es el **período de facturación de Stripe**, no el mes calendario: el contador se resetea cuando cierra el ciclo que el cliente pagó, para no regalar una cuota completa a quien paga el día 28. Requiere `subscriptions.current_period_start`, que la migración `0005` no incluía. Sin período conocido no hay envío (fail-closed).
El límite es un **tope práctico, no exacto**: como solo cuentan los envíos que Meta acepta, hay que llamar a Meta y después incrementar, y sin transacciones interactivas en el driver HTTP de Neon un puñado de requests concurrentes puede pasarse por decenas de mensajes.

### Cambio de plan
El **upgrade se aplica inmediato**: sube el techo y **conserva el consumo** del período (quien gastó 50.000 y sube a Pro tiene 50.000 restantes, no 100.000). Así ciclar planes no sirve para resetear cuota, y un cliente bloqueado puede desbloquearse pagando en el acto.
El **downgrade se difiere** al cierre del período: quien pagó el mes lo usa completo, mismo criterio que `cancel_at_period_end`. El Customer Portal de Stripe debe configurarse para diferirlo; por defecto Stripe lo aplica inmediato con prorrateo.

### Cuenta restringida
Estado degradado con dos causas: **cuota agotada** o **exceso de páginas** tras un downgrade (bajar a Starter con 5 páginas conectadas).
En ambos casos el comportamiento es el mismo: los entrantes se siguen persistiendo en la bitácora, dejan de reenviarse al webhook del cliente, y el envío queda bloqueado **para todas las páginas** del tenant, no solo las excedentes. No desconectamos páginas nosotros: desconectar es siempre acción del usuario.
Se levanta al resolverse la causa: nuevo período de facturación, o el usuario desconecta páginas hasta quedar dentro de su límite.
Se distingue del [Gate de suscripcion], que sí descarta los entrantes sin persistir.

### Errores de límite en la API
Dos códigos distintos, porque la acción del cliente es distinta:
- `402 Payment Required` + `quota_exceeded` — se arregla subiendo de plan.
- `403 Forbidden` + `page_limit_exceeded` — se arregla desconectando páginas.
- `403 Forbidden` + `plan_unavailable` — fail-closed cuando no se puede resolver el plan (`price_lookup_key` desconocido) o el [Período de cuota]. No es una causa de negocio sino una inconsistencia de datos: se arregla del lado de Resender, y el `message` manda a soporte.

Cada uno con `message` legible. Se suman al contrato de errores `snake_case` de `prd_api_separation.md`. Se descartó `429`, que comunica velocidad y no cuota comprada.

### Aviso de cuota
A partir del **80%** del consumo del período aparece una barra de alerta **global en el dashboard**, no solo en `Connections`: quien no entra a esa pantalla no se entera.
No hay email transaccional en esta entrega (no existe canal de correo en el repo). Pendiente: la FAQ pública promete "Te avisamos cuando te acercás al límite" dos veces en `content/i18n/es.ts`, que un cliente lee como email; hay que reescribirla para que apunte al dashboard.

### Gate de suscripcion
Con el [Gate de acceso (apagado)] fuera de juego, este es el **unico** gate: el registro esta abierto para cualquiera y la suscripcion decide quien puede usar. Un usuario sin suscripcion activa aterriza en la pagina de pricing. El acceso existe solo con status `active` en la tabla `subscriptions`; cualquier otro estado es **bloqueo total**: dashboard, OAuth de Meta y `POST /api/meta/send` (403) quedan cerrados, y los webhooks entrantes de Meta del tenant se descartan sin persistir (respondiendo `200` a Meta para no degradar la app). Mismo patron que usaba el gate de acceso: se lee de base de datos en cada request, fail-closed, nunca del JWT ni de la API de Stripe en el hot path.

### Sin trial
No hay periodo de prueba: para usar el producto hay que pagar. El primer cobro ocurre dentro del propio Stripe Checkout y no existe logica de trial en ninguna capa (ni `trial_period_days` en Checkout ni flags propios en base de datos).

### Stripe Checkout y Customer Portal
Resender no maneja datos de tarjeta: la compra se hace en la pagina de Checkout hosteada por Stripe (redirect) y toda la gestion posterior (cambiar plan, actualizar tarjeta, cancelar) ocurre en el Customer Portal de Stripe, enlazado desde `Settings`. La cancelacion es `cancel_at_period_end`: quien pago el mes lo usa completo. El servidor solo crea sesiones de Checkout/Portal via API con la secret key.

### Webhook de Stripe
El estado de las suscripciones se replica en Postgres consumiendo webhooks firmados de Stripe en `app/api/stripe/webhook` (verificacion con `STRIPE_WEBHOOK_SECRET`, espejo del patron HMAC del webhook de Meta). Eventos relevantes: `checkout.session.completed` y `customer.subscription.created/updated/deleted`, procesados con upsert idempotente sobre la tabla `subscriptions`. En desarrollo se usa `stripe listen` (Stripe CLI) para recibirlos en local.
