# PRD — Canal de Instagram (Instagram API con Instagram Login)

> **Estado: implementado** en la branch `integracon-instagram`, en los dos workers (`apps/web` y `apps/api`). Este documento describe el canal **tal como quedó construido**; reemplaza la versión anterior, que proponía rutas `/api/instagram/*` y dejaba los comentarios fuera de alcance.
>
> La decisión de arquitectura y su porqué están en `docs/adr/0008-instagram-como-segundo-canal.md`. Los términos canónicos, en `CONTEXT.md`.

## Problem Statement

Resender operaba un solo canal, **Facebook Messenger**: recibe webhooks, persiste conversaciones y mensajes, los reenvía al sistema externo del tenant (`webhookUrl`) y permite responder vía API con una API key opaca. Todo el modelo estaba cableado a "páginas de Facebook" —`connected_pages.meta_page_id` con `unique` global, tokens de página, `graph.facebook.com`, un único secreto de firma—. Los negocios que atienden por **Instagram Direct** no podían ser servidos, y los que reciben preguntas por **comentarios en sus publicaciones** tampoco: son dos superficies distintas de la misma cuenta y las dos son atención al cliente.

## Solution

Agregar Instagram como **segundo canal** sobre la plomería existente, usando **Instagram API con Instagram Login** (`graph.instagram.com`): el negocio inicia sesión con su cuenta profesional y no necesita Página de Facebook. El canal cubre **DMs y comentarios**, en paridad de alcance con el MVP de Messenger: solo texto y links.

La estrategia es generalizar "página conectada" a **cuenta conectada** con un discriminador `channel`, reutilizando `conversations`, `messages`, `api_keys`, el cifrado de tokens, la bitácora de entregas y el push externo. Solo se agregan las variantes propias de Instagram: OAuth, parseo de webhook, envío, y una tabla propia para comentarios.

## Decisión de arquitectura

- **Instagram API con Instagram Login**, no la variante con Facebook Login. Sin Página de Facebook y sin permisos `pages_*`.
- API base `graph.instagram.com`, Graph `v23.0` (la misma versión que usa `lib/meta.ts`).
- El **Instagram App Secret** es distinto del `META_APP_SECRET`: firma los webhooks de Instagram y es el `client_secret` del OAuth. De ahí las variables de entorno nuevas y la ruta de webhook separada.
- `channel` es un campo **aparte de `provider`**. `provider` sigue valiendo `"meta"` en los dos canales: Instagram es Meta y lo que cambia es la superficie.
- Las rutas son las de Facebook con `/instagram` insertado, no un árbol nuevo.

## User Stories

1. As a customer with an Instagram professional account, I want to connect Instagram from the Connections screen, so that I can route my Instagram Direct messages through Resender.
2. As a customer, I want the Instagram connection to use an Instagram login flow (not a Facebook Page), so that I do not need to create or link a Facebook Page.
3. As a customer who manages Messenger and Instagram, I want both channels listed together in Connections with a clear channel badge, so that I understand which channels are active.
4. As a customer, I want Resender to remember my connected Instagram account after restart or redeploy, so that I do not lose its access token or configuration.
5. As a customer, I want reconnecting an already-connected Instagram account to refresh its token and metadata idempotently, so that reconnecting repairs credentials without duplicating data.
6. As a customer, I want Resender to block connecting an Instagram account that already belongs to another tenant, so that cross-tenant takeover is impossible (same rule as pages).
7. As a customer, I want a per-account `webhookUrl` for Instagram, so that inbound Instagram events are pushed to the correct external automation.
8. As a customer, I want inbound Instagram messages and comments persisted even when no `webhookUrl` is set, so that I never lose the log.
9. As a customer, I want Resender to acknowledge Meta quickly for Instagram webhooks even if my external push is slow or broken, so that delivery stays healthy.
10. As an external automation, I want inbound payloads to carry a `type` discriminator plus `page.channel`, so that I can branch per event kind and per channel without extra lookups.
11. As an external automation, I want to reply to an Instagram DM through a protected send endpoint using my existing tenant API key, so that I do not need new credentials per channel.
12. As an external automation, I want to receive comments on my posts and answer them **publicly**, so that a public question gets a public answer.
13. As an external automation, I want to answer a commenter **privately by DM**, so that I can move a support case out of the public thread even if that person never messaged me.
14. As an external automation, I want a clear, specific error when a reply is rejected —expired token, closed window, already-answered comment— so that I know what to do about it.
15. As a customer, I want outgoing Instagram replies persisted whether Meta accepts or rejects them, so that the bitácora includes both successes and failures (same as Messenger).
16. As a customer, I want Resender to disconnect an Instagram account with confirmation while preserving its history, so that I can stop traffic without losing the log.
17. As a developer, I want Instagram added as a `channel` discriminator over the existing deep modules, so that conversations/messages/push/API-key code is reused and route handlers stay thin.

## Lo que se construyó

### Modelo de datos — migración `0013_instagram_channel.sql`

- `connected_pages` gana `channel text not null default 'messenger'` con `check (channel in ('messenger','instagram'))`, `token_expires_at` y `username` (el @handle). El default deja las filas existentes correctas sin backfill.
- El `unique` global sobre `meta_page_id` se reemplaza por `unique (channel, meta_page_id)`.
- Para Instagram, `meta_page_id` guarda el **IG user id** (el `user_id` del OAuth, que es el que llega como `entry.id` en el webhook) y `page_access_token_encrypted` el token de larga duración, cifrado con la misma clave que los page tokens de Messenger.
- Tabla nueva **`instagram_comments`**, con los mismos índices parciales de dedupe (`(connected_page_id, ig_comment_id)` donde `direction = 'inbound'`) e idempotencia (`(tenant_id, idempotency_key)` donde `direction = 'outbound'`) que ya usa `messages`.
- `external_webhook_deliveries` y `external_webhook_jobs` aceptan **mensaje o comentario**, con `check (num_nonnulls(message_id, instagram_comment_id) = 1)`.
- `messages.instagram_source_comment_id`: la respuesta privada a quien comentó es un DM y se persiste como tal; esta columna es lo único que la distingue y lo que permite auditar el límite de una por comentario.
- `conversations`, `messages` y `api_keys` se reutilizan sin más cambios de esquema.

> **Cuidado al aplicarla**: la migración rompió dos consultas de `apps/api` que dependían de los constraints eliminados (`on conflict (meta_page_id)` y `on conflict (message_id)`). Antes de tocar un constraint, grepear `on conflict` en los dos workers; antes de cambiar la cardinalidad de una FK, grepear los `join` que la usan.

### OAuth — `lib/instagram.ts` (`web`) e `infrastructure/meta/instagram-client.ts` (`api`)

Instagram Login no es una variante del OAuth de Facebook, es otro protocolo:

| | Facebook Login for Business | Instagram Login |
|---|---|---|
| Diálogo | `facebook.com/<v>/dialog/oauth` | `instagram.com/oauth/authorize` |
| Permisos | en el `config_id` | en `scope`, explícitos |
| Intercambio | `graph.facebook.com` | `api.instagram.com` + `graph.instagram.com` |
| Secreto | `META_APP_SECRET` | `INSTAGRAM_APP_SECRET` |
| Devuelve | N páginas a elegir | **una** cuenta |
| Token | no vence | ~60 días, se refresca |

Scopes: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.

Tres detalles que rompen el flujo si se ignoran, y que el cliente contempla:

- **El `code` llega con `#_` pegado al final** y ese sufijo no es parte del código. Sin quitarlo, el intercambio falla con un error que no nombra la causa.
- **Las respuestas vienen envueltas en `{"data":[{…}]}`**, no planas como en la documentación vieja. El cliente acepta las dos formas.
- **`user_id` ≠ `id`.** `id` es app-scoped; `user_id` es el IG ID de la cuenta profesional y es el que llega como `entry.id` en el webhook. El perfil se pide con `fields=user_id,username,name` explícito: guardar el equivocado dejaría la cuenta conectada y muda, y el síntoma no señala la causa.

`refreshInstagramToken` existe en los dos workers. **Todavía no lo llama nadie** (ver [Pendiente]).

### Rutas

| Superficie | `apps/web` (produce hoy) | `apps/api` (post fase 2) |
|---|---|---|
| Inicio de OAuth | `GET /api/meta/instagram/start` | RPC `connectInstagramAccount` |
| Callback | `GET /api/meta/instagram/callback` | (idem, un solo método) |
| Webhook | `GET/POST /api/meta/instagram/webhook` | `GET/POST /webhooks/meta/instagram` |
| Enviar DM | `POST /api/meta/instagram/send` | `POST /v1/messages` |
| Respuesta pública | `POST /api/meta/instagram/comments/reply` | `POST /v1/comments/{commentId}/replies` |
| Respuesta privada | `POST /api/meta/instagram/comments/private-reply` | `POST /v1/comments/{commentId}/private-replies` |
| Leer comentarios | — | `GET /v1/comments`, `/{id}`, `/{id}/deliveries` |
| Listar cuentas | pantalla `Connections` | `GET /v1/pages?channel=` |

El callback **persiste directo, sin pantalla de selección**: Instagram Login autoriza exactamente una cuenta. El orden es intercambio → perfil → suscripción al webhook → persistencia, y los tres pasos fallan con motivos distinguibles (`instagram_exchange_failed`, `instagram_profile_failed`, `instagram_subscription_failed`) porque son problemas distintos: credenciales o `redirect_uri` mal cargados, permisos no concedidos, y webhook sin configurar en la app de Meta.

La cookie de `state` es propia (`instagram_oauth_state`): los dos diálogos pueden estar abiertos en dos pestañas y compartirla haría que el segundo pisara el `state` del primero.

### Webhook entrante

`GET` verifica el reto contra `INSTAGRAM_VERIFY_TOKEN`; `POST` verifica `X-Hub-Signature-256` sobre el **body crudo** con `INSTAGRAM_APP_SECRET` y comparación timing-safe, ingiere y responde `200` rápido.

**Un parser por canal, una sola ingesta.** Los payloads de Messenger e Instagram no se parecen aunque compartan el sobre, pero el dedupe, la resolución cuenta→tenant, el gate de suscripción, la bitácora y la política de reintentos sí son los mismos. Duplicarlos habría dejado dos copias separándose cada vez que se toca una.

DMs (`entry[].messaging[]`):
- Se descarta **`is_echo`**: los mensajes que manda la propia cuenta vuelven como evento entrante y sin filtrarlos el sistema se responde a sí mismo en bucle.
- Se descarta **`is_deleted`**: es un envío que el usuario deshizo, no un mensaje nuevo.
- La cuenta receptora se toma de `entry.id` y no de `recipient.id`: en un eco los dos se invierten, y apoyarse en el campo que no depende de la dirección deja el parser correcto por construcción.
- No hay rama de postbacks a propósito: la cuenta se suscribe solo a `messages` y `comments`.

Comentarios — **con Instagram Login el evento llega plano sobre el `entry`** (`entry[].field` + `entry[].value`, con el id en `value.id`), no en `entry[].changes[]` con `value.comment_id` como en Facebook Login for Business. El parser acepta las dos formas: la documentación describe ambas para el mismo campo y todavía no hay tráfico real contra el cual confirmar cuál llega.

Dos trampas más de los comentarios:
- **`entry.time` viene en segundos** en los webhooks de comentarios y en **milisegundos** en los de mensajes. Se distingue por magnitud; interpretarlo mal fecharía todos los comentarios en 1970 y rompería el orden del hilo.
- **`live_comments` es otro campo** y se filtra: sin eso entraría por la misma puerta y se guardaría como comentario de una publicación.

### Anti-bucle

En DMs alcanza `is_echo`. En comentarios ese campo no existe, así que van **tres** señales, en orden de costo:

1. `from.id === entry.id`, en el parser, sin tocar la base.
2. `from.username === page.username`, en la ingesta, sin distinguir mayúsculas.
3. Que ese `ig_comment_id` sea de una fila `outbound` nuestra — la única que **no** depende del `from` que manda Meta. Va última porque es la única que consulta la base.

De este filtro depende que el sistema no entre en bucle publicando respuestas a sus propias respuestas, y el costo de una comparación de strings contra el de ese bucle no admite discusión.

### Envío

**DM** — `POST graph.instagram.com/v23.0/me/messages`. Tres diferencias con Messenger que no son cosméticas: no hay id en el path (el token identifica a la cuenta), el token va en el header `Authorization: Bearer` (efecto lateral bueno: deja de aparecer en logs de URLs), y **no lleva `messaging_type`**, que es un campo de la Send API de Messenger.

Body igual al de Messenger: `{ pageId, recipientId, reply, conversationId? }`, donde `pageId` es el IG id de la cuenta. Se lee raro en Instagram, pero es la misma columna en los dos canales y hace que un cliente que atiende ambos cambie la URL y nada más.

**Respuesta a comentario** — dos operaciones, porque Meta las trata como dos:

| | Respuesta pública | Respuesta privada |
|---|---|---|
| Endpoint de Meta | `POST /<ig-comment-id>/replies` | `POST /me/messages` con `recipient.comment_id` |
| Dónde aparece | debajo de la publicación | en la bandeja de DMs |
| Ventana | ninguna | **7 días** desde el comentario |
| Cuántas | las que se quieran | **una sola** por comentario |
| Se persiste en | `instagram_comments` | `messages`, con `instagram_source_comment_id` |

El body es `{ pageId, commentId, reply }` y **no acepta `recipientId`**: en la privada el IGSID sale del comentario guardado, y aceptarlo del cliente habría dejado mandarle un DM a cualquiera amparándose en un comentario ajeno. `commentId` es el id de Meta, que es el que el tenant siempre tiene.

El límite de una sola respuesta privada se verifica **contra nuestra base antes de llamar a Meta** y devuelve `409` con el id del mensaje que ya salió; Meta lo rechaza con un `100/2534025` que junta cuatro causas y no dice cuál. Solo cuentan los envíos que Meta aceptó: un intento fallido no consume la única respuesta disponible.

### Límites y errores

Tres superficies, tres límites, dos unidades: DM de Instagram **1000 bytes UTF-8**, comentario **2200 caracteres** (code points), mensaje de Messenger 2000 caracteres. Se validan antes de llamar a Meta y el `400` dice el número exacto.

**Tres catálogos de traducción de errores de Graph** —Messenger, DM de Instagram, comentario— porque los códigos coinciden pero la acción del usuario no:

| Código | Messenger | DM de Instagram | Comentario |
|---|---|---|---|
| 190 | revocaron permisos → reconectá la Página | el token venció solo (~60 días) → reconectá la cuenta | idem DM |
| 10 + subcode | ventana de 24 h (`2018278`) | ventana de 24 h (`2534022`) | — |
| 10 solo | falta `pages_messaging` | falta `instagram_business_manage_messages` | falta `instagram_business_manage_comments` |
| 100 | — | IGSID mal formado | comentario que ya no se puede contestar |

Los tres motivos que no dependen de qué se estaba enviando —token vencido, rate limit, bloqueo por política— viven una sola vez, con un test que verifica que los tres catálogos devuelvan el mismo string para esos códigos.

### Facturación

Instagram se factura **igual que Messenger**, sin excepciones (ADR 0010). Sus cuentas ocupan cupo —el límite del plan pasó a contar cuentas conectadas de cualquier canal— y sus tres superficies consumen cuota: DM entrante y saliente, comentario entrante, respuesta pública y respuesta privada. Con la cuota agotada o el cupo excedido, las rutas de Instagram devuelven 402/403 y sus entrantes dejan de reenviarse.

La entrega anterior lo había dejado fuera de las dos cosas: en `web` con una constante `CHANNEL_IS_METERED` y en `api` con un `periodStart: null` forzado. Las dos desaparecieron — la paridad se implementó borrando la excepción, no agregando una segunda.

### Payload al sistema externo

Aditivo, no rompe consumidores: `type: "message" | "comment"` como discriminador de primer nivel, y `page.channel` / `page.username` siempre presentes (`username` va `null` en Messenger). El evento de PostHog manda el id de un comentario bajo `instagram_comment_id` y no bajo `message_id`, para que "entregas fallidas" no mezcle dos cosas distintas.

### UI

Botón "Conectar Instagram" en `variant="outline"` junto al de Facebook, tarjeta propia en el estado vacío, y **badge de canal primero** en cada tarjeta. Instagram muestra `@handle · ig_id`; Messenger sigue mostrando `page_id`. El contador de cupo dice "N de M páginas de Facebook". `lucide-react` v1 ya no trae iconos de marca, así que Instagram usa `AtSign`.

## Testing Decisions

Vitest, tests colocados junto al módulo. Lo cubierto:

- **Cliente de OAuth**: URL de autorización con sus scopes y `redirect_uri`, intercambio corto → largo → perfil, las dos formas de respuesta (`{data:[…]}` y plana), el sufijo `#_` del código, y `user_id` vs `id`.
- **Webhook**: reto con verify token correcto e incorrecto, firma válida e inválida, y —el caso que más importa— **firmar con `META_APP_SECRET` debe fallar**. Para que ese test no pasara solo, `INSTAGRAM_APP_SECRET` tiene un valor distinto del de Facebook en la config de vitest.
- **Parsers**: DM, eco, borrado, comentario en forma plana y en forma `changes`, `live_comments`, timestamps en segundos y en milisegundos, y DM + comentario en el mismo payload.
- **Anti-bucle**: las tres señales por separado, incluido el caso en que las dos primeras dejan pasar y la tercera corta.
- **Ingesta**: resolución cuenta→tenant por `(channel, meta_page_id)`, dedupe por id repetido, persistencia sin `webhookUrl`, y que Instagram **no** incremente el contador de uso.
- **Envío**: forma del request (host, path, header Bearer, ausencia de `messaging_type`), límites de texto en su unidad correcta, idempotencia por `Idempotency-Key`, persistencia de `sent` y `failed`, y el `409` de la segunda respuesta privada.
- **Runtime HTTP en `apps/api`** con miniflare: las rutas nuevas contra el worker real, incluido que un evento de Instagram no resuelva contra una Página de Facebook con el mismo id.

Verificación adicional hecha a mano contra la base y contra la API real de Meta, con cuentas ficticias y tokens de prueba: la respuesta `190` de Meta es lo que confirma que host, path, header y body están bien armados —la request llegó bien y solo falló por el token falso—.

**Falta la prueba con tráfico real de Instagram**, que depende de conectar una cuenta de verdad y de confirmar la suscripción a `messages` y `comments` en el panel de Meta.

## Pendiente

- **Cron de refresh de tokens.** `refreshInstagramToken` y `token_expires_at` existen; no hay job que los use. A los ~60 días de la primera cuenta conectada deja de ser teórico.
- **`Messages` no muestra badge de canal ni comentarios.** Los DMs de Instagram entran a la bitácora existente; los comentarios solo se leen por API.
- **App Review de Instagram** (Advanced Access + verificación de negocio) antes de servir cuentas de terceros.

## Out of Scope

- Variante Instagram con Facebook Login / páginas (`pages_*`, `instagram_business_account`).
- Media (imágenes, audio, video, plantillas, stickers). Solo texto/links, en paridad con el MVP de Messenger.
- Ocultar o borrar comentarios, y menciones en stories.
- Etiqueta `human_agent` para responder fuera de la ventana de 24 h.
- Rate limiting propio para el límite de 200 DMs automatizados/hora/cuenta de Meta. El error se registra en `provider_response` cuando ocurra.
- Enriquecimiento de nombre de contacto desde el perfil de Instagram (se usa el IGSID, igual que el PSID en Messenger).
- Postbacks y quick replies.
- Publicación de contenido (`instagram_business_content_publish`).

## Riesgos

- **Doble secreto de firma.** El webhook de Instagram se firma con el Instagram App Secret, que no es `META_APP_SECRET`. Es el error de configuración más probable, y la razón de que Instagram tenga ruta propia.
- **Cuenta profesional obligatoria.** La cuenta debe ser Business o Creator; las personales no pueden conectar mensajería.
- **Expiración de token.** Sin el cron de refresh, las conexiones se caen a los ~60 días.
- **La ventana de 24 h no se valida en código**: se manda y se traduce el rechazo de Meta (`10/2534022`) a un mensaje claro. Es una decisión, no un olvido: el estado de la ventana lo tiene Meta, no nosotros.

---

# Guía de configuración en el panel de Meta

La parte manual, en [developers.facebook.com](https://developers.facebook.com). El código asume estos pasos hechos.

## Requisitos previos
- Una **cuenta profesional de Instagram** (Business o Creator): Configuración → Tipo de cuenta y herramientas → Cambiar a cuenta profesional.
- En esa cuenta, **Configuración y privacidad → Mensajes y respuestas a historias → Herramientas conectadas → "Permitir acceso a mensajes"**. Este toggle suele ser la causa de DMs que no llegan al webhook.
- Un origen HTTPS público (`APP_URL`) — en desarrollo, un túnel de ngrok contra el dev local.

## Paso 1 — App de Meta
Se usa una app **separada** de la productiva de Messenger (durante el desarrollo, "Resender.dev - Test1"), para no tocar la que está en revisión. Puede ser una app existente o una nueva de tipo Business.

## Paso 2 — Agregar el producto Instagram
Add Product → **Instagram** → Set up → **"API setup with Instagram login"** (NO "with Facebook login").

## Paso 3 — Credenciales
En **Instagram → API setup with Instagram login**:
- **Instagram App ID** → `INSTAGRAM_APP_ID`.
- **Instagram App Secret** → `INSTAGRAM_APP_SECRET`. ⚠️ Es **distinto** del App Secret de Facebook.

## Paso 4 — Webhook
1. Sección **"2. Configure webhooks"** (o Productos → Webhooks → objeto **Instagram**).
2. **Callback URL**:
   - `apps/web`: `https://<APP_URL>/api/meta/instagram/webhook`
   - `apps/api`: `https://<API_URL>/webhooks/meta/instagram`
3. **Verify token**: el mismo valor que `INSTAGRAM_VERIFY_TOKEN` (string largo y aleatorio, distinto del de Facebook).
4. **Verify and Save**. Meta hace un `GET` de verificación y el endpoint devuelve el `hub.challenge`.
5. Suscribir los campos **`messages`** y **`comments`**. Son los dos que el canal usa; `message_echoes` no se suscribe a propósito, porque los ecos se descartan igual y suscribirlos sería pagar tráfico para tirarlo.

> El binding por cuenta (`/me/subscribed_apps`) lo hace el código en el callback al conectar. Acá solo queda listo el webhook a nivel app.

## Paso 5 — Instagram business login (OAuth)
1. Sección **"3. Set up Instagram business login"** → **Business login settings**.
2. **OAuth redirect URI**: `https://<APP_URL>/api/meta/instagram/callback`. Debe ser **idéntica** a la que manda el código; si difiere, Instagram responde `redirect_uri` mismatch.
3. Scopes: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.

## Paso 6 — Cuenta de prueba
En **"1. Generate access tokens"**, agregá tu cuenta profesional. En modo desarrollo (Standard Access) se puede mandar y recibir con cuentas propias sin App Review.

## Paso 7 — Variables de entorno
```bash
INSTAGRAM_APP_ID="<del paso 3>"
INSTAGRAM_APP_SECRET="<del paso 3>"
INSTAGRAM_VERIFY_TOKEN="<el mismo string del paso 4>"
```
Van en `turbo.json` (`globalEnv`), `apps/web/.env`, `apps/api/.dev.vars` y el hosting. Si no se agregan a `turbo.json`, la caché de turbo queda mal.

## Paso 8 — App Review (solo para cuentas de terceros)
1. **Business Verification** en Meta Business Settings.
2. **App Review** de `instagram_business_manage_messages` e `instagram_business_manage_comments` en Advanced Access, con screencast del caso de uso y descripción del uso de datos.

Para cuentas propias o pruebas internas alcanza Standard Access en modo desarrollo.

## Checklist de validación end-to-end
1. Conectar la cuenta desde Connections → aparece con badge "Instagram" y `@handle`.
2. Mandarle un DM desde otra cuenta → llega al webhook, se persiste y aparece en Messages.
3. Con `webhookUrl` configurado → el sistema externo recibe el payload con `type: "message"` y `page.channel: "instagram"`.
4. Responder por `POST /api/meta/instagram/send` con la API key del tenant, dentro de las 24 h → el DM llega y queda `sent`.
5. Comentar una publicación desde otra cuenta → llega con `type: "comment"`, con `mediaId` y `from`.
6. Responder públicamente → el comentario aparece bajo la publicación y **no** vuelve a ingestarse cuando Meta lo reenvía.
7. Responder privadamente → el DM llega al que comentó; un segundo intento sobre el mismo comentario devuelve `409`.
8. Verificar que el contador de uso del tenant **no** se movió en ninguno de los pasos anteriores.
