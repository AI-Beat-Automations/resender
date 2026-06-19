# PRD — Conexión de Google Reviews (Google Business Profile + Cloud Pub/Sub)

> Extiende el MVP descrito en `prd_mvp.md` y sigue la misma convención que `prd_instagram.md`. Incorpora un canal nuevo (`channel = "google_business"`) que **ingiere reseñas** de la ficha de Google del negocio (Google Maps / Búsqueda) y las reenvía al `webhookUrl` del tenant, reutilizando la mayor parte de la plomería existente (OAuth, cifrado de tokens, push externo, bitácora de entregas). A diferencia de Messenger/Instagram, **este canal es de una sola vía (entrante)**: captura reseñas nuevas/actualizadas; responder reseñas queda como extensión (ver _Out of Scope_).

## Problem Statement

Hoy Resender solo opera canales de **mensajería** (Messenger; Instagram en `prd_instagram.md`): recibe webhooks HMAC-firmados, persiste conversaciones/mensajes y los reenvía al sistema externo del tenant. Un negocio que quiere reaccionar automáticamente a **reseñas nuevas en su ficha de Google** (responder con IA, notificar a un equipo, registrar en un CRM vía n8n) no tiene forma de hacerlo: no existe un webhook nativo de Google Maps para "comentario nuevo en mi perfil", y el flujo de reseñas es técnicamente distinto al de mensajería (no es HMAC, no es bidireccional, el evento no trae el contenido completo). Falta un canal que conecte la ficha de Google del negocio, escuche reseñas en tiempo real y las empuje al `webhookUrl` configurado con la misma garantía de bitácora que el resto de Resender.

## Solution

Agregar **Google Reviews como canal entrante** usando la **Google Business Profile API** (antes "Google My Business") junto con **Google Cloud Pub/Sub**, que es el único mecanismo oficial de notificación en tiempo real que ofrece Google para reseñas.

Flujo de extremo a extremo:

```
Reseña nueva en la ficha de Google (Maps/Búsqueda)
        ↓
Google publica un mensaje en  →  Cloud Pub/Sub Topic (de NUESTRO proyecto GCP)
        ↓ (push subscription con token OIDC)
POST /api/google/pubsub (Resender)  →  verifica JWT OIDC → resuelve tenant → trae la reseña vía API → persiste en google_reviews → reenvía a webhookUrl → registra en external_webhook_deliveries
```

El negocio conecta su cuenta de Google con un flujo **OAuth** propio (scope `https://www.googleapis.com/auth/business.manage`). En el callback, Resender obtiene el `refresh_token`, lista las cuentas/ubicaciones que administra y llama a `accounts.updateNotificationSetting` para vincular la cuenta del negocio a **nuestro** topic de Pub/Sub con los tipos `NEW_REVIEW` y `UPDATED_REVIEW`. A partir de ahí, cada reseña nueva genera un mensaje en el topic compartido; Resender lo recibe, identifica a qué tenant pertenece (por `accountId`/`locationId` que vienen en el mensaje), llama a la API de reseñas para traer el contenido completo, lo persiste en una **tabla dedicada `google_reviews`** y lo reenvía al webhook del tenant.

La estrategia de implementación reutiliza el discriminador `channel` sobre `connected_pages` (igual que el PRD de Instagram), el cifrado de tokens, el push externo (`external-push.ts`), la bitácora (`external_webhook_deliveries`) y la regla de propiedad exclusiva por tenant. Lo específico de Google son: el OAuth de Google, la verificación OIDC del push de Pub/Sub, el fetch en dos pasos de la reseña, la nueva tabla `google_reviews` y el refresh de tokens (los access tokens de Google expiran en ~1h).

## Decisión de arquitectura (transporte y modelo)

- **Transporte = Cloud Pub/Sub push, no webhook HMAC.** Google no envía un webhook firmado con un app secret (como Meta). Publica en un topic de Pub/Sub y una _push subscription_ hace `POST` a nuestro endpoint con un **JWT OIDC firmado por Google** en el header `Authorization: Bearer`. La verificación es por validación de ese JWT (firma + `aud` + `email` del service account), **no** por HMAC `X-Hub-Signature-256`. Por eso se usa una ruta nueva `/api/google/pubsub` y **no** se reutiliza el verificador de `/api/meta/webhook`.
- **Topic compartido, binding por cuenta.** Existe **un** topic de Pub/Sub en nuestro proyecto GCP. Cada cuenta de negocio conectada apunta su `notificationSetting` a ese mismo topic. El mensaje identifica `account`/`location`, lo que permite resolver el tenant. (No hay un topic por tenant.)
- **Evento ligero + fetch.** El mensaje de Pub/Sub indica _qué_ cambió (`notificationType = NEW_REVIEW` + recurso de la ubicación/reseña), no el texto de la reseña. Resender hace una segunda llamada a la API de reseñas para traer reviewer, rating y comentario. ⚠️ El endpoint de **reseñas** sigue viviendo en la API legada `mybusiness.googleapis.com/v4` (no migró a las APIs versionadas nuevas); las **notificaciones** viven en `mybusinessnotifications.googleapis.com/v1`. Verificar el shape exacto del payload contra el entorno real (ver _Riesgos_).
- **Modelo de datos = tabla dedicada `google_reviews`.** Una reseña (rating + comentario + autor + respuesta + timestamps) no calza en el modelo `messages` (texto + dirección). Se crea una tabla propia. La _fuente conectada_ sí reutiliza `connected_pages` vía `channel = "google_business"`.
- **Solo aplica a fichas que el usuario administra.** La Business Profile API solo expone reseñas de negocios donde el usuario autenticado es **dueño/administrador verificado**. No se pueden capturar reseñas de fichas ajenas con API oficial (eso solo sería posible con scraping de terceros, fuera de alcance).

## User Stories

1. As a customer who owns a verified Google Business Profile, I want to connect Google from the Connections screen, so that new reviews on my Google listing are routed through Resender.
2. As a customer, I want the Google connection to use a Google OAuth login with the `business.manage` scope, so that Resender can read my reviews and subscribe me to notifications.
3. As a customer who manages several locations, I want all locations I administer under the authorized Google account subscribed to review notifications, so that I do not configure them one by one.
4. As a customer, I want Resender to remember my connected Google account after restart or redeploy, so that I do not lose its refresh token or notification binding.
5. As a customer, I want reconnecting an already-connected Google account to refresh its tokens and re-bind the notification setting idempotently, so that reconnecting repairs the connection without duplicating data.
6. As a customer, I want Resender to block connecting a Google location that already belongs to another tenant, so that cross-tenant takeover is impossible (same rule as pages).
7. As a customer, I want to configure a per-source `webhookUrl` for Google, so that inbound reviews are pushed to the correct external automation.
8. As a customer, I want inbound reviews persisted even when no `webhookUrl` is set, so that I never lose the review log.
9. As a customer, I want Resender to acknowledge the Pub/Sub push quickly even if my external push is slow or broken, so that Google does not retry/backoff the subscription.
10. As an external automation, I want inbound review payloads to include a `channel: "google_business"` field plus tenant/location/review context (reviewer, starRating, comment, createTime, reviewId, reply link), so that I can branch logic per channel without extra lookups.
11. As a customer, I want each review delivery (success/failed/skipped) recorded, so that the bitácora covers reviews like it covers messages.
12. As a customer, I want duplicate or repeated Pub/Sub deliveries of the same review to be deduplicated, so that my external webhook is not called twice for the same review.
13. As a customer, I want an `UPDATED_REVIEW` (edited review) to be captured and forwarded too, so that I can react to rating changes.
14. As a customer, I want my Google reviews visible in the product (a reviews list with channel indicator), so that I have a single bitácora.
15. As a customer, I want Resender to disconnect a Google account with confirmation while preserving historical reviews and clearing the notification binding, so that I stop traffic without losing the log.
16. As a product owner, I want Google access tokens refreshed automatically using the stored refresh token before they expire (~1h), so that the API calls and re-binding keep working.
17. As a developer, I want Google support added as a `channel` discriminator over the existing deep modules plus a dedicated `google_reviews` table, so that OAuth/push/API-key/delivery code is reused and route handlers stay thin.

## Implementation Decisions

### Modelo de datos
- **Fuente conectada (reuso):** añadir a `connected_pages` la columna `channel text not null default 'messenger'` con `check (channel in ('messenger','instagram','google_business'))` (si Instagram ya la agregó, solo se extiende el `check`). Mentalmente `connected_pages` pasa a ser "fuentes conectadas".
  - Para Google, `meta_page_id` almacena el **location resource name** (`accounts/{accountId}/locations/{locationId}`) o el `locationId`; se guarda también `google_account_id` (ver columnas nuevas). `page_access_token_encrypted` almacena el **access token** cifrado.
  - Reemplazar/garantizar el índice único `unique(channel, meta_page_id)` (no `unique(meta_page_id)` solo) para no colisionar entre namespaces de IDs.
  - Columnas nuevas en `connected_pages`:
    - `google_account_id text null` — `accounts/{accountId}` que administra la ubicación (necesario para llamar a reseñas y a `updateNotificationSetting`).
    - `refresh_token_encrypted text null` — refresh token de Google cifrado (Messenger/Instagram no lo usan; Google sí).
    - `token_expires_at timestamptz null` — expiración del access token (~1h). (Si Instagram ya la añadió, se reutiliza.)
- **Reseñas (tabla dedicada nueva):** `google_reviews`
  - `id` (PK), `connected_page_id` (FK → `connected_pages.id`), `tenant_id`.
  - `google_review_id text not null` — id/nombre del recurso de la reseña.
  - `reviewer_display_name text null`, `star_rating int null` (1–5; mapear el enum `STAR_RATING` de Google a entero), `comment text null`.
  - `review_create_time timestamptz null`, `review_update_time timestamptz null`.
  - `reply_comment text null`, `reply_update_time timestamptz null` (para `UPDATED_REVIEW`/respuestas, aunque responder no esté en alcance).
  - `notification_type text not null` (`NEW_REVIEW` | `UPDATED_REVIEW`).
  - `raw jsonb not null` — payload crudo de la reseña tal como lo devolvió la API (auditoría/forward fiel).
  - `created_at timestamptz not null default now()`.
  - **Idempotencia:** `unique (connected_page_id, google_review_id)` (índice único) para deduplicar reentregas de Pub/Sub. En `UPDATED_REVIEW` se hace upsert sobre esa clave.
- **Reenvío/bitácora (reuso sin cambios):** `external_webhook_deliveries` se reutiliza para registrar cada push de reseña (success/failed/skipped). Si su esquema referencia `message_id`, generalizar a una referencia neutral o añadir `google_review_id null` (decisión menor de migración).
- `api_keys`, cifrado y SSE se reutilizan tal cual.
- Migración nueva: `apps/web/db/migrations/000X_google_reviews.sql` (número siguiente al último aplicado; si Instagram aterriza primero será `0003`, si no `0002`), ejecutada con `npm --workspace web run db:migrate`.

### OAuth (Google Business Profile)
- Nuevo cliente `apps/web/lib/google.ts` que refleja a `lib/meta.ts`:
  - `buildGoogleAuthUrl(state)` → `https://accounts.google.com/o/oauth2/v2/auth` con `client_id=GOOGLE_OAUTH_CLIENT_ID`, `redirect_uri=${APP_URL}/api/google/callback`, `response_type=code`, `scope=https://www.googleapis.com/auth/business.manage`, `access_type=offline`, `prompt=consent` (para garantizar `refresh_token`), `state`.
  - `exchangeCodeForGoogleTokens(code)` → `POST https://oauth2.googleapis.com/token` (form) con `client_id`, `client_secret=GOOGLE_OAUTH_CLIENT_SECRET`, `grant_type=authorization_code`, `redirect_uri`, `code` → `{ access_token, refresh_token, expires_in }`.
  - `refreshGoogleToken(refreshToken)` → `POST https://oauth2.googleapis.com/token` con `grant_type=refresh_token` → `{ access_token, expires_in }`.
  - `listGoogleAccounts(accessToken)` → `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`.
  - `listGoogleLocations(accessToken, accountId)` → `GET https://mybusinessbusinessinformation.googleapis.com/v1/{accountId}/locations?readMask=name,title`.
  - `updateGoogleNotificationSetting(accessToken, accountId)` → `PATCH https://mybusinessnotifications.googleapis.com/v1/{accountId}/notificationSetting?updateMask=pubsubTopic,notificationTypes` con body `{ pubsubTopic: GOOGLE_PUBSUB_TOPIC, notificationTypes: ["NEW_REVIEW","UPDATED_REVIEW"] }`.
  - `listGoogleReviews(accessToken, accountId, locationId)` → `GET https://mybusiness.googleapis.com/v4/{accountId}/{locationId}/reviews?orderBy=updateTime desc` (API legada v4, sigue siendo la de reseñas). Usado para traer la reseña tras la notificación.
- Rutas nuevas: `apps/web/app/api/google/start/route.ts` (siembra cookie `state` CSRF y redirige) y `apps/web/app/api/google/callback/route.ts` (valida `state`, intercambia código, persiste tokens cifrados, lista ubicaciones, llama `updateGoogleNotificationSetting` por cada cuenta). Reflejan a `app/api/meta/start` y `app/api/meta/callback`.

### Persistencia de la conexión
- Extender `apps/web/lib/pages/page-registry.ts` con `connectGoogleLocations(...)` (o generalizar el connect para aceptar `channel`). Por cada ubicación administrada hace upsert transaccional en `connected_pages` con `channel='google_business'`, cifra `access_token` y `refresh_token` (`lib/crypto/encryption.ts`), guarda `google_account_id` y `token_expires_at`, y aplica la regla `PageOwnershipError` (una ubicación pertenece a un solo tenant).
- Tras persistir, dispara `updateGoogleNotificationSetting` una vez por `accountId` para enlazar la cuenta al topic. Reconexión idempotente: refresca tokens y re-aplica el binding.
- Resolvedores: `getActiveSourceByGoogleLocation(locationId)` y `getActiveSourceByGoogleAccount(accountId)` para mapear el mensaje de Pub/Sub → tenant.

### Entrada (push de Pub/Sub)
- Ruta nueva `apps/web/app/api/google/pubsub/route.ts` (solo `POST`):
  1. **Verificación OIDC (reemplaza al HMAC):** lee el header `Authorization: Bearer <JWT>`, valida la firma del JWT contra las llaves públicas de Google, y comprueba `aud == GOOGLE_PUBSUB_AUDIENCE` y `email == GOOGLE_PUBSUB_SA_EMAIL` (el service account de la push subscription). Si falla → `401`. (Defensa en profundidad: opcionalmente un `?token=` secreto en la URL de la subscription.)
  2. **Decodifica** el envelope de Pub/Sub: `{ message: { data: <base64>, messageId, publishTime }, subscription }`. `JSON.parse(base64decode(message.data))` → notificación con `account`, `location`/recurso afectado y `notificationType`.
  3. **Filtra**: procesa solo `NEW_REVIEW` y `UPDATED_REVIEW`; cualquier otro tipo → `204` sin trabajo.
  4. **Resuelve la fuente/tenant** por `accountId`/`locationId`. Si no hay fuente activa → `204` (ack para no reintentar).
  5. **Trae la reseña** con `listGoogleReviews` usando el token de la fuente (refrescándolo si `token_expires_at` venció), reconciliando contra `google_reviews` por `google_review_id` para tomar la reseña nueva/actualizada.
  6. **Ingiere** (persiste en `google_reviews`, upsert idempotente) y **dispara el push no bloqueante** con `after()`.
  7. Devuelve **`200`/`204` rápido** para que Pub/Sub considere entregado el mensaje (igual filosofía que el 200 rápido de Meta; si respondes error o tardas, Pub/Sub reintenta con backoff).
- Parseo/verificación viven en `apps/web/lib/inbound/google-pubsub.ts` (`verifyPubsubOidcToken`, `parsePubsubReviewNotification`). No se mezcla con `meta-webhook.ts` (transporte distinto).

### Ingestión y reenvío
- `apps/web/lib/inbound/google-ingestion.ts` (nuevo, espejo de `inbound-ingestion.ts`): `ingestGoogleReview({ source, review, notificationType })` → upsert idempotente en `google_reviews`, publica al SSE (opcional, para la lista en vivo) y arma el `pushJob`.
- `apps/web/lib/inbound/external-push.ts` (reuso, extendido): `buildInboundPushPayload` agrega `channel: "google_business"` y, para reseñas, un bloque neutral, p. ej.:
  ```json
  {
    "channel": "google_business",
    "tenant": { "id": "..." },
    "source": { "id": "...", "channel": "google_business", "googleAccountId": "accounts/123", "locationId": "accounts/123/locations/456", "name": "Mi Negocio" },
    "review": {
      "id": "accounts/.../reviews/AbC",
      "reviewer": "Juan P.",
      "starRating": 5,
      "comment": "Excelente servicio",
      "createTime": "2026-06-17T...Z",
      "updateTime": "2026-06-17T...Z",
      "notificationType": "NEW_REVIEW"
    }
  }
  ```
  Mantiene compatibilidad: los consumidores de Messenger/Instagram ramifican por `channel`. Reusa `pushInboundMessage` (POST con timeout) y `recordDelivery`/`recordSkippedDelivery` en `external_webhook_deliveries`.

### Respuesta a reseñas (opcional / extensión)
- La API permite responder reseñas con `PUT https://mybusiness.googleapis.com/v4/{review.name}/reply` (`{ comment }`). Si se quiere paridad con el "send" de mensajería, se expondría `POST /api/google/reply` autenticado por API key del tenant, resolviendo token server-side y persistiendo en `google_reviews.reply_*`. **Fuera del alcance inicial** (este PRD es solo ingesta entrante); se documenta para no rediseñar el modelo después.

### Refresh de tokens
- Los access tokens de Google expiran en ~1h, pero el `refresh_token` es de larga duración. Dos estrategias combinables:
  - **On-demand**: antes de cada llamada a la API (`listGoogleReviews`, etc.), si `token_expires_at` está vencido/próximo, refrescar con `refreshGoogleToken` y actualizar `page_access_token_encrypted` + `token_expires_at`. (Suficiente para el flujo entrante, porque las llamadas son disparadas por eventos.)
  - **Cron opcional**: ruta interna `apps/web/app/api/google/refresh-tokens/route.ts` (protegida por `CRON_SECRET`, Vercel Cron) para re-aplicar `updateNotificationSetting` y mantener tokens calientes. El binding de notificaciones no caduca por sí solo, pero conviene re-confirmarlo periódicamente.

### Configuración / secretos
- Variables de entorno nuevas (agregar a `turbo.json` `globalEnv`, `apps/web/.env` y `README.md`):
  - `GOOGLE_OAUTH_CLIENT_ID` — OAuth client ID (Google Cloud Console → Credentials).
  - `GOOGLE_OAUTH_CLIENT_SECRET` — OAuth client secret.
  - `GOOGLE_PROJECT_ID` — proyecto GCP que aloja el topic.
  - `GOOGLE_PUBSUB_TOPIC` — `projects/<GOOGLE_PROJECT_ID>/topics/<topic>` (el que se pasa a `updateNotificationSetting`).
  - `GOOGLE_PUBSUB_AUDIENCE` — `aud` esperado en el JWT OIDC del push (configurado en la subscription).
  - `GOOGLE_PUBSUB_SA_EMAIL` — email del service account que firma el push OIDC (para validar `email` del token).
  - (opcional) `CRON_SECRET` — protege la ruta de refresh.
- Se reutilizan `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL`, `API_KEY_PEPPER`, `AUTH_SECRET`.

### UI
- En Connections, añadir botón **"Conectar Google"** → `GET /api/google/start`. Listar las ubicaciones de Google junto a páginas/cuentas con un badge de canal y el mismo editor de `webhookUrl` y acción de desconectar (con confirmación) que ya existe. Al desconectar, además de desactivar la fuente, limpiar el `notificationSetting` (vaciar `pubsubTopic`/`notificationTypes`).
- Reseñas: una vista de reseñas (reusar el patrón de Messages o una pantalla nueva ligera) con reviewer, rating en estrellas, comentario, fecha y badge de canal. Esta vista lee de `google_reviews`. (Mínimo viable: que aparezcan; UI rica es secundaria.)

### Principios
- Route handlers y páginas se mantienen como capas delgadas sobre los deep modules (igual que el MVP/Instagram).
- No se rompen Messenger ni Instagram: `channel` default `'messenger'`, rutas `/api/meta/*` y `/api/instagram/*` intactas, y la nueva tabla `google_reviews` no toca `messages`/`conversations`.

## Testing Decisions

- `lib/google.ts`: construcción correcta de la URL de autorización (scope `business.manage`, `access_type=offline`, `prompt=consent`, redirect); intercambio código → tokens (mock fetch) incluyendo presencia de `refresh_token`; `refreshGoogleToken` actualiza access token; manejo de errores por paso.
- `lib/inbound/google-pubsub.ts`:
  - `verifyPubsubOidcToken`: JWT válido (firma + `aud` + `email` correctos) pasa; firma inválida / `aud` distinto / `email` distinto → `401`.
  - `parsePubsubReviewNotification`: decodifica base64 `message.data`, extrae `account`/`location`/`notificationType`; ignora tipos no-review.
- Ruta `/api/google/pubsub`: 401 con token inválido; 204 cuando no hay fuente activa o tipo no soportado; 200/204 rápido en éxito; idempotencia (dos entregas del mismo `google_review_id` → un solo insert y un solo push); push no bloqueante cuando el externo falla (no rompe el ack).
- Ingestión: resolución `accountId`/`locationId` → tenant; upsert en `google_reviews`; persistencia aunque no haya `webhookUrl` (registro `skipped`); `UPDATED_REVIEW` actualiza la fila existente.
- Propiedad exclusiva: bloquear ubicación de Google ya conectada por otro tenant (`PageOwnershipError`); reconexión idempotente del mismo tenant refresca tokens y re-aplica el binding.
- Payload de push externo: incluye `channel:"google_business"` y el bloque `review` con reviewer/starRating/comment/createTime/notificationType.
- Refresh de token: refresco on-demand cuando `token_expires_at` venció, sin romper fuentes con token vigente.
- Un test de integración por ruta nueva (`/api/google/callback`, `/api/google/pubsub`) que verifique cableado y códigos de estado.

## Out of Scope (esta fase)

- **Responder reseñas** vía API (`reviews.reply`). Documentado arriba como extensión; el modelo `google_reviews` ya deja los campos `reply_*` listos.
- Reseñas de fichas que el usuario **no administra** (no es posible con API oficial; el scraping de terceros queda excluido).
- Otros tipos de notificación de Business Profile (Q&A, media, Google updates, cambios de estado de la ubicación). Solo `NEW_REVIEW`/`UPDATED_REVIEW`.
- Borrado de reseñas (`DELETED_REVIEW`/desaparición) y reconciliación histórica masiva (backfill de reseñas previas a la conexión). Esta fase es _forward-only_ desde el momento de conectar.
- Soporte multi-cuenta complejo (jerarquías de organizaciones/grupos de ubicaciones). Se asume cuenta(s) directa(s) del negocio.
- UI rica de gestión de reseñas (filtros, métricas, sentimiento). Mínimo: listar.
- Rate limiting propio para los QPM de la Business Profile API (se documenta y se registra el error de Google en la bitácora cuando ocurra).

## Further Notes / Riesgos

- **Gate de aprobación de Google (bloqueante para producción):** la Business Profile API **no entrega quota hasta que Google aprueba** una solicitud de acceso (quota = 0 significa "no aprobado"). Requisitos típicos: caso de uso de negocio legítimo, sitio web válido, y GBP verificado con **60+ días** de antigüedad. Este gate puede tardar y bloquea las pruebas end-to-end. **Hasta tener acceso, no se puede validar el flujo real**; se puede construir el código y testear con mocks. (Ver guía de configuración.)
- **Verificación de OAuth de Google:** `business.manage` es un scope sensible; para producción la app debe pasar la verificación de OAuth (consent screen). Sin verificar, queda limitada a usuarios de prueba.
- **Transporte distinto (riesgo de config #1):** confundir el modelo de Meta (HMAC `X-Hub-Signature-256`) con el de Google (JWT OIDC de Pub/Sub) es el error más probable. Por eso la ruta y el verificador son separados.
- **Evento sin contenido:** el mensaje de Pub/Sub no trae el texto de la reseña; hay que llamar a la API de reseñas. Validar el **shape exacto** del `message.data` y del endpoint de reseñas (la API de reseñas vive en la **v4 legada** `mybusiness.googleapis.com/v4`, no en las APIs versionadas nuevas) contra el entorno real antes de cerrar el parser.
- **Permiso del service account:** hay que conceder `pubsub.topics.publish` a `mybusiness-api-pubsub@system.gserviceaccount.com` sobre el topic, o Google no podrá publicar y no llegará ninguna notificación (fallo silencioso).
- **Topic compartido:** todas las cuentas publican al mismo topic; la resolución del tenant depende de `accountId`/`locationId` del mensaje. Si no se guarda bien `google_account_id`/`locationId` en `connected_pages`, no se podrá mapear el evento.
- **Expiración de token:** a diferencia de Messenger, los access tokens de Google expiran en ~1h; sin refresh con el `refresh_token`, las llamadas a la API fallan. El `prompt=consent`/`access_type=offline` es obligatorio para recibir `refresh_token`.
- **SSE single-process:** `lib/message-store.ts` es buffer en memoria de un solo proceso; vale para UI en vivo pero no es un bus durable (igual que en el MVP). La durabilidad real la dan `google_reviews` + `external_webhook_deliveries`.

---

# Guía de configuración en Google Cloud + Business Profile (lo que haces tú)

Esta es la parte manual. El código de arriba asume que estos pasos quedaron hechos. Hay dos bloques: **(A) solicitar acceso a la API** (gate de Google) y **(B) montar GCP + OAuth + Pub/Sub**.

## Bloque A — Solicitar acceso a la Google Business Profile API (one-time, puede tardar)

> Sin esto, tu proyecto tiene **quota = 0** y nada funciona en producción.

1. Ten un **Google Business Profile verificado** del negocio, con **60+ días** de antigüedad y sitio web válido.
2. En [Google Cloud Console](https://console.cloud.google.com) crea/elige un proyecto y **habilita las Business Profile APIs** (Account Management, Business Information, **My Business Notifications**, y la **My Business API v4** para reseñas).
3. Llena el **formulario de solicitud de acceso** de la Business Profile API (Google → "request access"/"basic setup" en developers.google.com/my-business). Describe el caso de uso (gestionar reseñas de tu negocio / clientes y reenviarlas a automatizaciones).
4. Espera aprobación. Sabrás que estás aprobado cuando la **quota deja de ser 0** (p. ej. 300 QPM).

## Bloque B — GCP, OAuth y Pub/Sub

### Paso 1 — OAuth client + consent screen
1. Google Cloud Console → **APIs & Services → OAuth consent screen**: configura el consent (tipo External), agrega el scope `https://www.googleapis.com/auth/business.manage`, y agrega tu cuenta como **test user** (para probar antes de verificar).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized redirect URI**: `https://<TU_APP_URL>/api/google/callback`
   - Copia **Client ID** → `GOOGLE_OAUTH_CLIENT_ID` y **Client secret** → `GOOGLE_OAUTH_CLIENT_SECRET`.

### Paso 2 — Crear el topic de Pub/Sub
1. Console → **Pub/Sub → Topics → Create topic**. Nombre p. ej. `gbp-reviews`. Resulta en `projects/<PROJECT_ID>/topics/gbp-reviews` → `GOOGLE_PUBSUB_TOPIC`.
2. En el topic → **permissions / Add principal**: agrega `mybusiness-api-pubsub@system.gserviceaccount.com` con rol **Pub/Sub Publisher** (`pubsub.topics.publish`). ⚠️ Sin esto Google no puede publicar.

### Paso 3 — Crear la push subscription con OIDC
1. En el topic → **Create subscription**.
2. **Delivery type: Push**. **Endpoint URL**: `https://<TU_APP_URL>/api/google/pubsub`.
3. Habilita **Enable authentication** → elige/crea un **service account** (p. ej. `pubsub-push@<PROJECT_ID>.iam.gserviceaccount.com`) → su email va a `GOOGLE_PUBSUB_SA_EMAIL`.
4. **Audience**: pon un valor (p. ej. tu `APP_URL` o un string fijo) → va a `GOOGLE_PUBSUB_AUDIENCE`. El código valida `aud` y `email` del JWT contra estas variables.

### Paso 4 — Variables de entorno en el software
Pon en `apps/web/.env` (y en tu hosting):
```bash
GOOGLE_OAUTH_CLIENT_ID="<Client ID del paso 1>"
GOOGLE_OAUTH_CLIENT_SECRET="<Client secret del paso 1>"
GOOGLE_PROJECT_ID="<tu PROJECT_ID>"
GOOGLE_PUBSUB_TOPIC="projects/<PROJECT_ID>/topics/gbp-reviews"
GOOGLE_PUBSUB_AUDIENCE="<el audience del paso 3>"
GOOGLE_PUBSUB_SA_EMAIL="pubsub-push@<PROJECT_ID>.iam.gserviceaccount.com"
# opcional, para el cron de refresh
CRON_SECRET="<string aleatorio>"
# Reutilizadas (ya existen):
APP_URL="https://<tu-origen-publico>"
TOKEN_ENCRYPTION_KEY="<ya configurado>"
DATABASE_URL="<ya configurado>"
```

### Paso 5 — Vincular la cuenta del negocio (lo hace el código)
El binding por-cuenta (`accounts.updateNotificationSetting` → tu topic) lo ejecuta Resender automáticamente en `/api/google/callback` cuando el negocio conecta su cuenta. Aquí solo dejas listos el topic, la subscription y las credenciales.

## Checklist de validación end-to-end (cuando haya acceso aprobado)
1. Conectar la cuenta de Google desde Connections → debe aparecer la(s) ubicación(es) con badge "Google".
2. Verificar que `updateNotificationSetting` se aplicó (la cuenta apunta a tu topic con `NEW_REVIEW`/`UPDATED_REVIEW`).
3. Publicar una reseña de prueba en la ficha (o usar otra cuenta de Google para reseñar) → Google publica en el topic → llega `POST /api/google/pubsub`, se trae la reseña, se persiste en `google_reviews` y aparece en la vista de reseñas.
4. Si hay `webhookUrl` configurado → el sistema externo recibe el payload con `channel:"google_business"` y el bloque `review`.
5. Reentregar el mismo mensaje (Pub/Sub puede reintentar) → no se duplica la reseña ni el push (idempotencia por `google_review_id`).
6. Editar la reseña → llega `UPDATED_REVIEW`, se actualiza la fila y se reenvía.
7. Desconectar la cuenta → se limpia el `notificationSetting` y dejan de llegar mensajes; el historial en `google_reviews` se conserva.
