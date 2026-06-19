# PRD — Conexión de Instagram (Instagram API con Instagram Login)

> Extiende el MVP descrito en `prd_mvp.md`. Instagram estaba listado como _Out of Scope_ en el MVP (`prd_mvp.md` línea 140); este documento lo incorpora como un canal nuevo (`channel = "instagram"`) reutilizando la mayor parte de la plomería existente de Messenger.

## Problem Statement

Hoy Resender solo opera el canal de **Facebook Messenger** (páginas de Facebook): recibe webhooks, persiste conversaciones/mensajes, los reenvía al sistema externo del tenant (`webhookUrl`) y permite responder vía API con una API key opaca. Todo el modelo de datos y de OAuth está cableado a "páginas de Facebook" (`connected_pages.meta_page_id`, tokens de página, `graph.facebook.com`). Los negocios que atienden a sus clientes por **Instagram Direct** no pueden ser servidos: sus DMs entrantes no se reenvían y no se pueden responder por API. Falta un canal de Instagram que se comporte igual que Messenger (gateway + bitácora) sin romper el canal actual.

## Solution

Agregar **Instagram como un segundo canal** usando la **Instagram API con Instagram Login** (camino recomendado por Meta, sin requerir Página de Facebook). El negocio conecta su cuenta profesional de Instagram con un flujo OAuth propio (`www.instagram.com/oauth/authorize` → token de corta duración → token de larga duración de ~60 días). Resender suscribe el webhook de mensajes de esa cuenta, recibe los DMs entrantes, los persiste en el mismo modelo de conversaciones/mensajes, los reenvía al `webhookUrl` configurado y expone un endpoint protegido para responder los DMs por API dentro de la ventana de 24 horas.

La estrategia de implementación es **generalizar el concepto de "página conectada" a "cuenta conectada"** mediante un discriminador `channel`, reutilizando las tablas `conversations`, `messages`, `external_webhook_deliveries`, `api_keys`, el cifrado de tokens, el push externo y el SSE tal cual. Solo se añaden las variantes específicas de Instagram para OAuth, parseo de webhook y envío.

## Decisión de arquitectura (canal elegido)

- Se usa **Instagram API con Instagram Login** (no la variante con Facebook Login).
- API base: `graph.instagram.com`, versión de Graph `v23.0` (igual que la constante `GRAPH` actual en `lib/meta.ts`).
- No requiere Página de Facebook ni permisos de `pages_*`. El negocio inicia sesión directamente con su cuenta profesional de Instagram.
- El **Instagram App Secret** (distinto del `META_APP_SECRET` de la app de Facebook) firma los webhooks de Instagram y se usa como `client_secret` en el intercambio de token. Esto introduce variables de entorno nuevas.

## User Stories

1. As a customer with an Instagram professional account, I want to connect Instagram from the Connections screen, so that I can route my Instagram Direct messages through Resender.
2. As a customer, I want the Instagram connection to use an Instagram login flow (not a Facebook Page), so that I do not need to create or link a Facebook Page.
3. As a customer who manages Messenger and Instagram, I want both channels listed together in Connections with a clear channel badge, so that I understand which channels are active.
4. As a customer, I want Resender to remember my connected Instagram account after restart or redeploy, so that I do not lose its access token or configuration.
5. As a customer, I want reconnecting an already-connected Instagram account to refresh its token and metadata idempotently, so that reconnecting repairs credentials without duplicating data.
6. As a customer, I want Resender to block connecting an Instagram account that already belongs to another tenant, so that cross-tenant takeover is impossible (same rule as pages).
7. As a customer, I want to configure a per-account `webhookUrl` for Instagram, so that inbound Instagram DMs are pushed to the correct external automation.
8. As a customer, I want inbound Instagram messages persisted even when no `webhookUrl` is set, so that I never lose the message log.
9. As a customer, I want Resender to acknowledge Meta quickly for Instagram webhooks even if my external push is slow or broken, so that delivery stays healthy.
10. As an external automation, I want inbound Instagram payloads to include a `channel: "instagram"` field plus tenant/account/conversation/message context, so that I can branch logic per channel without extra lookups.
11. As an external automation, I want to reply to an Instagram DM through a protected send endpoint using my existing tenant API key, so that I do not need new credentials per channel.
12. As an external automation, I want Resender to reject replies outside the 24-hour Instagram messaging window with a clear error, so that I do not silently fail Meta policy.
13. As a customer, I want outgoing Instagram replies persisted whether Meta accepts or rejects them, so that the bitácora includes both successes and failures (same as Messenger).
14. As a customer, I want my Instagram conversations to appear in the same Messages screen with a channel indicator, so that I operate all channels from one bitácora.
15. As a customer, I want Resender to disconnect an Instagram account with confirmation while preserving its historical messages, so that I can stop traffic without losing the log.
16. As a product owner, I want Instagram long-lived tokens to be refreshed automatically before they expire (~60 days), so that connections do not silently break.
17. As a developer, I want Instagram support added as a `channel` discriminator over the existing deep modules, so that conversations/messages/push/API-key code is reused and route handlers stay thin.

## Implementation Decisions

### Modelo de datos
- Añadir columna `channel text not null default 'messenger'` a `connected_pages`, con `check (channel in ('messenger','instagram'))`. Mentalmente, `connected_pages` pasa a ser "cuentas conectadas".
- Para Instagram, `meta_page_id` almacena el **IG user id** (el `user_id` que devuelve el OAuth y que llega como `entry.id` en el webhook). `page_access_token_encrypted` almacena el token de larga duración de Instagram cifrado.
- Reemplazar el índice `unique(meta_page_id)` por `unique(channel, meta_page_id)` para evitar colisiones entre namespaces de IDs de página de FB e IDs de cuenta de IG.
- Añadir `token_expires_at timestamptz null` a `connected_pages` para soportar el refresh de tokens de Instagram (los page tokens de Messenger no expiran; los de IG sí, ~60 días).
- `conversations`, `messages`, `external_webhook_deliveries`, `api_keys` se reutilizan **sin cambios de esquema**. El `meta_message_id` de `messages` guarda el `mid` de Instagram. El canal de un mensaje se deriva por join con `connected_pages.channel`.
- Migración nueva: `apps/web/db/migrations/0002_instagram_channel.sql`, ejecutada con `npm --workspace web run db:migrate`.

### OAuth (Instagram Business Login)
- Nuevo cliente `apps/web/lib/instagram.ts` que refleja a `lib/meta.ts`:
  - `buildInstagramAuthUrl(state)` → `https://www.instagram.com/oauth/authorize` con `client_id=INSTAGRAM_APP_ID`, `redirect_uri=${APP_URL}/api/instagram/callback`, `response_type=code`, `scope=instagram_business_basic,instagram_business_manage_messages`, `state`.
  - `exchangeCodeForInstagramAccount(code)`:
    1. `POST https://api.instagram.com/oauth/access_token` (form-urlencoded) con `client_id`, `client_secret=INSTAGRAM_APP_SECRET`, `grant_type=authorization_code`, `redirect_uri`, `code` → `{ data: [{ access_token, user_id, permissions }] }` (token corto, ~1h).
    2. `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=<corto>` → token largo (~60 días) + `expires_in`.
    3. `GET https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=<largo>` → metadata de la cuenta (username para mostrar).
  - `subscribeInstagramWebhook(token)` → `POST https://graph.instagram.com/v23.0/me/subscribed_apps?subscribed_fields=messages` con el token de la cuenta.
  - `refreshInstagramToken(token)` → `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...` (el token debe tener ≥24h).
- Rutas nuevas: `apps/web/app/api/instagram/start/route.ts` (siembra cookie de `state` CSRF y redirige) y `apps/web/app/api/instagram/callback/route.ts` (valida `state`, intercambia código, persiste, suscribe webhook). Reflejan exactamente a `app/api/meta/start` y `app/api/meta/callback`.

### Persistencia de la conexión
- Extender `apps/web/lib/pages/page-registry.ts` con `connectInstagramAccount(...)` (o generalizar `connectAuthorizedPages` para aceptar `channel`). Reutiliza el cifrado de token (`lib/crypto/encryption.ts`), la regla de propiedad exclusiva (`PageOwnershipError`) y el upsert transaccional.
- `getActivePageByMetaPageId` se resuelve por `(channel, meta_page_id)`; `getActivePageWithTokenForTenant` recibe `channel`.

### Webhook entrante
- Ruta nueva `apps/web/app/api/instagram/webhook/route.ts`:
  - `GET`: verificación de reto comparando `hub.verify_token` contra `INSTAGRAM_VERIFY_TOKEN` y devolviendo `hub.challenge`.
  - `POST`: lee el **raw body**, verifica `X-Hub-Signature-256` con HMAC-SHA256 usando **`INSTAGRAM_APP_SECRET`** (constante de tiempo, igual que el route de Messenger), ingiere y dispara push no bloqueante con `after()`. Devuelve `200 {ok:true}` rápido.
  - Se usa una ruta separada (no se comparte `/api/meta/webhook`) porque el secreto de firma es el de Instagram y el payload trae `object: "instagram"`.
- Parseo: añadir `extractInstagramInboundTextMessages(body)` en `apps/web/lib/inbound/meta-webhook.ts` (o branch por `body.object === "instagram"`). El payload de Instagram trae `object:"instagram"`, `entry[].messaging[]`, `entry.id` = IG account id, `sender.id` = **IGSID** del cliente, `message.mid` y `message.text`. Mapea a la misma forma normalizada que ya consume la ingestión.

### Ingestión y reenvío
- `apps/web/lib/inbound/inbound-ingestion.ts`: generalizar `ingestMetaWebhookPayload` para recibir `channel` (o agregar `ingestInstagramWebhookPayload`). Resuelve la cuenta con `getActivePageByMetaPageId(channel, accountId)`, hace `upsertConversation`, `insertInboundMessage` (idempotente por el índice único parcial), publica al SSE y arma el `pushJob`. Todo reutilizado.
- `apps/web/lib/inbound/external-push.ts`: `buildInboundPushPayload` agrega `channel` al payload y expone el id de cuenta de forma neutral (p. ej. `account: { id, channel, externalId, name }`) manteniendo compatibilidad con el consumidor actual. Así N8N/IA sabe que el mensaje vino de Instagram.

### Envío (responder por API)
- `apps/web/lib/outbound/meta-send.ts`: añadir `sendInstagramTextMessage(igId, token, recipientId, text)` → `POST https://graph.instagram.com/v23.0/{igId}/messages` con header `Authorization: Bearer <token>` y body `{ recipient: { id: <IGSID> }, message: { text } }`, timeout 10s. (Messenger usa `?access_token=` en query; Instagram usa header Bearer y `graph.instagram.com`.)
- Endpoint de envío: extender `POST /api/meta/send` con un campo `channel` opcional (default `"messenger"`) **o** añadir `POST /api/instagram/send`. Se reutiliza `authenticateApiKey` (la misma API key del tenant sirve para ambos canales, consistente con la decisión MVP de API keys tenant-wide), la validación de `parseOutboundSendInput`, la resolución de cuenta+token por tenant y la persistencia con `insertOutboundMessage`.
- El token de Instagram nunca viaja en la request; se resuelve del registro y se descifra en el servidor (igual que Messenger).

### Ventana de 24 horas y límites
- Solo se puede responder a un usuario de Instagram dentro de las **24 horas** posteriores a su último mensaje. Resender debe rechazar (4xx con error claro) o etiquetar como `human_agent` (hasta 7 días, solo soporte) los envíos fuera de ventana. Para el alcance inicial: rechazar fuera de ventana; `human_agent` queda como extensión.
- Límite de Meta: **200 DMs automatizados/hora/cuenta** y 100 llamadas/seg/cuenta. No se implementa rate limiting propio en esta fase, pero se documenta y se registra el error de Meta en `provider_response` cuando ocurra.

### Refresh de tokens
- Los tokens largos de Instagram expiran en ~60 días. Se requiere un job que llame `refreshInstagramToken` antes del vencimiento (recomendado: Vercel Cron diario que recorra cuentas IG con `token_expires_at` próximo y actualice token + `token_expires_at`). Ruta interna protegida `apps/web/app/api/instagram/refresh-tokens/route.ts` (autenticada por secreto de cron). Es nuevo respecto al MVP (Messenger no lo necesita).

### Configuración / secretos
- Variables de entorno nuevas (agregar a `turbo.json` `globalEnv`, `apps/web/.env` y `README.md`):
  - `INSTAGRAM_APP_ID` — Instagram App ID (panel de Meta → producto Instagram → API setup with Instagram login).
  - `INSTAGRAM_APP_SECRET` — Instagram App Secret (firma de webhook + `client_secret` del OAuth).
  - `INSTAGRAM_VERIFY_TOKEN` — token de verificación del webhook de Instagram.
  - (opcional) `CRON_SECRET` — para proteger la ruta de refresh.
- Se reutilizan `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL`, `API_KEY_PEPPER`, `AUTH_SECRET`.

### UI
- En Connections, añadir botón **"Conectar Instagram"** → `GET /api/instagram/start`. Listar cuentas IG junto a las páginas con un badge de canal y el mismo editor de `webhookUrl` y acción de desconectar (con confirmación) que ya existe para páginas.
- En Messages, mostrar el canal de cada conversación (badge Messenger/Instagram). La lista, el orden por actividad y el filtro se reutilizan.

### Principios
- Route handlers y páginas se mantienen como capas delgadas sobre los deep modules (igual que el MVP).
- La compatibilidad del canal Messenger no se rompe: `channel` default `'messenger'` y rutas `/api/meta/*` intactas.

## Testing Decisions

- `lib/instagram.ts`: construcción correcta de la URL de autorización (scopes y redirect), e intercambio de código → token corto → token largo → metadata (mockeando fetch). Manejo de errores de cada paso.
- Webhook de Instagram: verificación de reto (`hub.verify_token` correcto/incorrecto), validación de firma `X-Hub-Signature-256` con `INSTAGRAM_APP_SECRET` (válida/ inválida → 401), y respuesta rápida 200.
- Parser `extractInstagramInboundTextMessages`: extrae IG account id (`entry.id`), IGSID (`sender.id`), `mid` y `text` desde un payload real `object:"instagram"`; ignora eventos no-mensaje.
- Ingestión: resolución cuenta→tenant por `(channel, meta_page_id)`, upsert de conversación, idempotencia por `mid` duplicado, persistencia sin `webhookUrl`, push no bloqueante cuando el externo falla.
- Propiedad exclusiva: bloquear cuenta IG ya conectada por otro tenant; reconexión idempotente del mismo tenant refresca token/metadata.
- Envío: autenticación por API key, ownership por tenant del canal IG, persistencia de `sent` y `failed`, rechazo fuera de ventana de 24h, forma correcta del request (`graph.instagram.com`, header Bearer, body recipient/message).
- Payload de push externo incluye `channel:"instagram"` y contexto de cuenta/conversación/mensaje.
- Refresh de token: actualiza `page_access_token_encrypted` y `token_expires_at`; no rompe cuentas con token < 24h.
- Un test de integración por ruta nueva (`/api/instagram/webhook`, `/api/instagram/callback`, send) que verifique cableado y códigos de estado.

## Out of Scope (esta fase)

- Variante Instagram con Facebook Login / páginas (`pages_*`, `instagram_business_account`).
- Mensajes con media (imágenes, audio, video, plantillas, stickers). Esta fase es **solo texto/links**, en paridad con el MVP de Messenger.
- Etiqueta `human_agent` para responder fuera de la ventana de 24h (hasta 7 días).
- Rate limiting propio para el límite de 200 DMs/hora.
- Enriquecimiento de nombre de contacto desde el perfil de Instagram (se usa el IGSID como identidad, igual que el PSID en Messenger).
- Comentarios de Instagram, menciones en stories, postbacks/quick replies (solo `messages`).
- Publicación de contenido (`instagram_business_content_publish`).

## Further Notes / Riesgos

- **Doble secreto de firma**: el webhook de Instagram se firma con el Instagram App Secret, que **no** es el `META_APP_SECRET` actual. Es el error más probable de configuración. Por eso se usa una ruta de webhook separada con su propia variable.
- **Cuenta profesional obligatoria**: la cuenta de Instagram debe ser Business o Creator. Las cuentas personales no pueden conectar mensajería.
- **App Review + verificación de negocio**: para servir cuentas que no son tuyas se necesita **Advanced Access** de `instagram_business_manage_messages` (requiere App Review con screencast y verificación del negocio). Para cuentas propias o de prueba alcanza **Standard Access** en modo desarrollo.
- **Ventana de 24h**: a diferencia del MVP (que asumía Messenger 24h pero no la forzaba en código), aquí conviene validarla explícitamente para no fallar silenciosamente la política de Meta.
- **Expiración de token**: a diferencia de Messenger, Instagram requiere refresh periódico; sin el cron, las conexiones se caen a los ~60 días.

---

# Guía de configuración en el panel de Meta (lo que haces tú)

Esta es la parte manual que ejecutas en [developers.facebook.com](https://developers.facebook.com). El código de arriba asume que estos pasos quedaron hechos.

## Requisitos previos
- Una **cuenta profesional de Instagram** (Business o Creator). Conviértela en el app de Instagram: Configuración → Tipo de cuenta y herramientas → Cambiar a cuenta profesional.
- En la cuenta de Instagram, habilita el acceso a mensajes para herramientas conectadas: **Configuración y privacidad → Mensajes y respuestas a historias → Herramientas conectadas → "Permitir acceso a mensajes"** (este toggle suele ser causa de DMs que no llegan al webhook).
- Tu app desplegada con HTTPS público (`APP_URL`), porque Meta valida el webhook contra una URL pública.

## Paso 1 — App de Meta
1. Entra a developers.facebook.com → **My Apps**. Puedes **reutilizar tu app actual** (la de Messenger) o crear una nueva de tipo **Business**.
2. Si creas una nueva: **Create App → Business → ...** y complétala.

## Paso 2 — Agregar el producto Instagram
1. Dentro de la app → **Add Product** → busca **Instagram** → **Set up**.
2. Elige **"API setup with Instagram login"** (NO "with Facebook login"). Esta es la opción que corresponde a la decisión de este PRD.

## Paso 3 — Copiar credenciales de Instagram
1. En **Instagram → API setup with Instagram login** verás:
   - **Instagram App ID** → va a `INSTAGRAM_APP_ID`.
   - **Instagram App Secret** → va a `INSTAGRAM_APP_SECRET`. ⚠️ Es **distinto** del App Secret de Facebook. Guárdalo bien.

## Paso 4 — Configurar el webhook de Instagram
1. En la misma pantalla, sección **"2. Configure webhooks"** (o Producto → Webhooks → objeto **Instagram**).
2. **Callback URL**: `https://<TU_APP_URL>/api/instagram/webhook`
3. **Verify token**: el mismo valor que pongas en `INSTAGRAM_VERIFY_TOKEN` (inventa un string largo y aleatorio).
4. Haz clic en **Verify and Save**. Meta hará un `GET` de verificación contra tu endpoint; debe responder el `hub.challenge`.
5. En **fields**, suscríbete a **`messages`** (mínimo). Opcionales útiles a futuro: `messaging_postbacks`, `messaging_reactions`, `messaging_seen`.

> El binding por-cuenta (`/me/subscribed_apps`) lo hace el código automáticamente en el callback al conectar cada cuenta. Aquí solo dejas el webhook a nivel app listo.

## Paso 5 — Configurar el Instagram Business Login (OAuth)
1. En **Instagram → API setup with Instagram login**, sección **"3. Set up Instagram business login"** (o **Business login settings**).
2. **OAuth redirect URI**: `https://<TU_APP_URL>/api/instagram/callback`
3. Permisos / scopes a habilitar para el login:
   - `instagram_business_basic`
   - `instagram_business_manage_messages`
4. Guarda. (Estos scopes son los que el código pasa en `buildInstagramAuthUrl`.)

## Paso 6 — Agregar tu cuenta de Instagram para pruebas
1. En **"1. Generate access tokens"**, agrega tu cuenta profesional de Instagram como cuenta de prueba / conéctala.
2. En modo desarrollo (Standard Access) puedes mandar y recibir mensajes con tus propias cuentas de prueba sin App Review. Úsalo para validar todo el flujo end-to-end.

## Paso 7 — Variables de entorno en el software
Pon en `apps/web/.env` (y en tu hosting):
```bash
INSTAGRAM_APP_ID="<Instagram App ID del paso 3>"
INSTAGRAM_APP_SECRET="<Instagram App Secret del paso 3>"
INSTAGRAM_VERIFY_TOKEN="<el mismo string del paso 4>"
# Reutilizadas (ya existen):
APP_URL="https://<tu-origen-publico>"
TOKEN_ENCRYPTION_KEY="<ya configurado>"
DATABASE_URL="<ya configurado>"
```

## Paso 8 — App Review y verificación de negocio (solo para producción / cuentas de terceros)
- Necesario únicamente cuando vas a servir cuentas de Instagram que **no** son tuyas:
  1. **Business Verification** del negocio en Meta Business Settings.
  2. **App Review** de `instagram_business_manage_messages` (Advanced Access): requiere un screencast mostrando el caso de uso (recibir un DM y responderlo por la API) y descripción del uso de datos.
- Para tus propias cuentas o pruebas internas, **no** necesitas App Review: alcanza Standard Access en modo desarrollo.

## Checklist de validación end-to-end
1. Conectar la cuenta IG desde Connections → debe aparecer con badge "Instagram".
2. Enviar un DM a la cuenta desde otra cuenta de Instagram → debe llegar a `/api/instagram/webhook`, persistirse y aparecer en Messages.
3. Si hay `webhookUrl` configurado → el sistema externo recibe el payload con `channel:"instagram"`.
4. Responder vía `POST /api/instagram/send` (o `/api/meta/send` con `channel:"instagram"`) usando la API key del tenant, dentro de las 24h → el DM llega al usuario en Instagram y queda persistido como `sent`.
5. Esperar/forzar >24h → un intento de respuesta debe quedar `failed` con error de ventana.
