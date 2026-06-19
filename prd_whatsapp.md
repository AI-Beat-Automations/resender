# PRD — Conexión de WhatsApp (Cloud API + Embedded Signup, modelo Tech Provider)

> Extiende el MVP descrito en `prd_mvp.md` y sigue la misma convención que `prd_instagram.md` y `prd_google_reviews.md`. Incorpora un canal nuevo (`channel = "whatsapp"`) que recibe e ingiere mensajes de WhatsApp Business y los reenvía al `webhookUrl` del tenant, reutilizando la mayor parte de la plomería existente (OAuth, cifrado de tokens, webhook firmado, push externo, bitácora de entregas, envío autenticado por API key). A diferencia de Messenger/Instagram, WhatsApp impone una **ventana de servicio de 24 h** y exige **plantillas pre-aprobadas** para iniciar conversación; además, llevar el canal a producción depende de un **gate administrativo de Meta** (Business Verification + App Review como _Tech Provider_) que tarda semanas. La decisión de integrar **directo contra la Cloud API** (no vía un BSP) está registrada en `docs/adr/0001-whatsapp-direct-cloud-api-tech-provider.md`.

## Problem Statement

Hoy Resender opera canales de mensajería de Meta vía Facebook Login + webhooks HMAC-firmados (Messenger implementado; Instagram en `prd_instagram.md`). Un negocio que atiende a sus clientes por **WhatsApp** no tiene forma de enrutar esa conversación a su automatización (responder con IA, registrar en CRM vía n8n) a través de Resender. WhatsApp no encaja "gratis" en la plomería de Messenger por cuatro diferencias técnicas y una administrativa:

1. **Onboarding distinto:** no se conectan "páginas"; se conecta una **WhatsApp Business Account (WABA)** y uno o varios **números de teléfono**, mediante el flujo **Embedded Signup** (Facebook Login for Business con un `config_id` propio).
2. **Activación del número por API:** además de obtener el token, hay que **registrar** el número en la Cloud API (`/{phone_number_id}/register`) y **suscribir** la app al WABA (`/{waba_id}/subscribed_apps`) antes de poder enviar/recibir.
3. **Ventana de 24 h + plantillas:** se puede responder en texto libre solo dentro de las 24 h desde el último mensaje del usuario; fuera de esa ventana, todo mensaje proactivo requiere una **plantilla aprobada** por Meta.
4. **Shape de webhook propio:** el evento llega con `object: "whatsapp_business_account"` y estructura `entry[].changes[].value.messages[]` / `value.statuses[]` (distinta a la de Messenger `entry[].messaging[]`).
5. **Gate de App Review (Tech Provider):** para operar números de **otros** negocios (multi-tenant) Resender necesita **Advanced Access** a `whatsapp_business_messaging` y `whatsapp_business_management`, lo cual exige Business Verification + App Review.

## Solution

Agregar **WhatsApp como canal bidireccional** usando la **WhatsApp Cloud API** (`graph.facebook.com`, Graph v23.0) directamente —Resender como su **propio Tech Provider**— y **Embedded Signup** para el alta self-service de los WABA/números de cada tenant.

Flujo de extremo a extremo:

```
Alta (una vez por tenant):
  Connections → botón "Conectar WhatsApp" → FB.login(config_id) [Embedded Signup popup]
        ↓ (postMessage: waba_id, phone_number_id) + (redirect/callback: code)
  /api/whatsapp/callback → exchange code → token (cifrado) → /{phone}/register (PIN) → /{waba}/subscribed_apps
        ↓
  connected_pages (channel='whatsapp', meta_page_id=phone_number_id, waba_id=…)

Mensaje entrante (runtime):
  Cliente escribe al número de WhatsApp del negocio
        ↓
  Meta POST /api/whatsapp/webhook  (object:"whatsapp_business_account", X-Hub-Signature-256)
        ↓ verifica firma (HMAC) → resuelve tenant por phone_number_id → persiste msg → 200 rápido
        ↓ after(): push no bloqueante al webhookUrl del tenant → registra en external_webhook_deliveries

Respuesta saliente:
  Sistema externo → POST /api/whatsapp/send (Bearer API key) → /{phone}/messages
        ↓ texto libre si dentro de ventana 24 h; si no, plantilla aprobada → persiste (sent|failed)
```

La estrategia reutiliza el discriminador `channel` sobre `connected_pages` (igual que Instagram/Google), el cifrado de tokens, el verificador de firma del webhook, el push externo (`external-push.ts`), la bitácora (`external_webhook_deliveries`), el modelo `messages`/`conversations` y el envío autenticado por API key. Lo específico de WhatsApp es: el flujo Embedded Signup, el registro del número y la suscripción del WABA, el parser del nuevo shape de webhook, la **enforcement de la ventana de 24 h** y el envío de plantillas.

## Decisión de arquitectura (transporte y modelo)

- **Integración directa (Cloud API, Tech Provider), no BSP.** Resender llama `graph.facebook.com` directamente, igual que con Messenger, y carga con los trámites de Meta. Decisión y trade-offs en `docs/adr/0001-whatsapp-direct-cloud-api-tech-provider.md`.
- **Transporte = webhook HMAC, igual que Meta/Messenger.** El webhook de WhatsApp se firma con **`X-Hub-Signature-256`** usando el **App Secret** de la misma Meta App. Por eso **se reutiliza el verificador de firma existente**; lo único que cambia es el _shape_ del payload (`object:"whatsapp_business_account"`, `changes[].value.messages[]`). Se usa una ruta nueva `/api/whatsapp/webhook` para no mezclar parsers, pero el mecanismo de verificación es el mismo.
- **Misma Meta App, productos distintos.** Resender usa **una** Meta App que aloja los productos Messenger y WhatsApp. Por eso el **App Secret se comparte** (`META_APP_SECRET`) y solo se agrega un `config_id` propio para el Embedded Signup de WhatsApp y un verify token propio para su webhook. (Contrastar con Instagram-con-Instagram-Login, que sí requiere app/secret separados.)
- **Onboarding por Embedded Signup, sin `solutionID`.** En el modelo directo se usa `FB.login` con `config_id` y `response_type: "code"`; del popup se capturan `waba_id` y `phone_number_id` (vía `postMessage`, `sessionInfoVersion: 3`) y se intercambia el `code` por el token. El campo `solutionID`/Partner Solution **es del modelo BSP** y aquí **no se usa**.
- **Identidad de la fuente = `phone_number_id`.** En `connected_pages`, para WhatsApp `meta_page_id` almacena el **`phone_number_id`** (es lo que enruta webhooks y envíos), y se añade `waba_id` aparte. El índice único pasa a `unique(channel, meta_page_id)` para no colisionar entre namespaces de IDs.
- **Modelo de datos = se reutiliza `messages`/`conversations`.** Un mensaje de WhatsApp (texto + dirección + estado) **sí** calza en `messages` (a diferencia de una reseña de Google). El `contact_id` es el `wa_id` (teléfono E.164 sin `+`) del cliente, y —ventaja sobre el PSID de Messenger— el webhook trae `contacts[].profile.name`, así que `contact_name` se puede poblar desde el inicio.
- **Ventana de 24 h como regla de dominio.** El envío de texto libre solo es válido dentro de las 24 h desde el último mensaje **entrante** de esa conversación; fuera de la ventana se exige `type: "template"` con una plantilla aprobada. Esto se valida en el `send` (mismo espíritu que la ventana de 24 h del PRD de Instagram).

## User Stories

1. As a customer with a WhatsApp Business Account, I want to connect WhatsApp from the Connections screen via Embedded Signup, so that my WhatsApp conversations are routed through Resender without manual Meta dashboard work.
2. As a customer, I want Resender to register my phone number on the Cloud API and subscribe my WABA automatically during connection, so that messages start flowing without extra steps.
3. As a customer who manages several numbers under one WABA, I want each connected number to appear as its own source with its own `webhookUrl`, so that I can route them to different automations.
4. As a customer, I want Resender to remember my WhatsApp connection (token, waba_id, phone_number_id) after restart or redeploy, so that I do not lose the connection.
5. As a customer, I want reconnecting an already-connected number to refresh its token and re-subscribe idempotently, so that reconnecting repairs the connection without duplicating data.
6. As a customer, I want Resender to block connecting a phone number that already belongs to another tenant, so that cross-tenant takeover is impossible (same rule as pages).
7. As a customer, I want a per-source `webhookUrl`, so that inbound WhatsApp messages are pushed to the correct external automation; if none is set, the message is still logged.
8. As a customer, I want Resender to acknowledge Meta's webhook quickly (200 ≤ a few seconds) even if my external push is slow or broken, so that Meta does not retry/backoff.
9. As an external automation, I want inbound payloads to include `channel: "whatsapp"` plus tenant/source/conversation/message context (wa_id, profile name, text, wamid, timestamp), so that I can branch logic per channel without extra lookups.
10. As an external automation, I want to reply via `POST /api/whatsapp/send` authenticated with the tenant API key, so that I can respond using the same credential model as Messenger.
11. As a customer, I want free-form replies accepted only inside the 24-hour customer-service window, and template sends required outside it, so that Resender does not silently fail against Meta's policy.
12. As an external automation, I want to send an approved template by name (with variables) outside the window, so that I can re-engage a customer compliantly.
13. As a customer, I want inbound idempotency by `wamid`, so that Meta re-deliveries do not duplicate messages or external pushes.
14. As a customer, I want delivery-status callbacks (`sent`/`delivered`/`read`/`failed`) reflected on the outbound message, so that the bitácora shows real delivery state.
15. As a customer, I want my WhatsApp conversations visible in Messages with a channel badge, so that I have a single bitácora across channels.
16. As a customer, I want to disconnect a WhatsApp number with confirmation while preserving history and stopping traffic, so that I can stop without losing the log.
17. As a developer, I want WhatsApp added as a `channel` discriminator over the existing deep modules, so that OAuth/webhook/push/API-key/delivery code is reused and route handlers stay thin.
18. As a product owner, I want the shared platform-compliance pieces (privacy policy, data-deletion, terms, reviewer test access) in place, so that the WhatsApp App Review is not auto-rejected — these are shared with the pending Messenger review (`fb_requirements.md`).

## Implementation Decisions

### Modelo de datos
- **Fuente conectada (reuso):** extender `connected_pages`:
  - `channel text not null default 'messenger'` con `check (channel in ('messenger','instagram','whatsapp'))` (si Instagram/Google ya lo añadieron, solo se extiende el `check`).
  - Para WhatsApp, `meta_page_id` almacena el **`phone_number_id`**. `page_access_token_encrypted` almacena el **token de negocio** (system user / business integration token) cifrado.
  - Garantizar el índice único `unique(channel, meta_page_id)` (no solo `unique(meta_page_id)`).
  - Columnas nuevas en `connected_pages`:
    - `waba_id text null` — WhatsApp Business Account ID (necesario para `subscribed_apps`, plantillas y gestión).
    - `whatsapp_phone_e164 text null` — número en formato E.164 para mostrar en UI (display name humano del número).
    - `token_expires_at timestamptz null` — expiración del token (reuso si Instagram/Google ya la agregó; para system-user tokens puede ser `null` = no expira).
- **Mensajes (reuso):** `conversations` y `messages` se reutilizan tal cual.
  - `messages.meta_message_id` guarda el **`wamid`**; el índice único parcial `unique(connected_page_id, meta_message_id)` da idempotencia de entrantes.
  - `messages.contact_id` = `wa_id` (teléfono sin `+`); `conversations.contact_name` = `value.contacts[].profile.name`.
  - `messages.status` admite los mismos valores (`received|sent|failed`); los callbacks de estado (`delivered`/`read`) se reflejan actualizando la fila por `wamid` (ver _Entrada_). `provider_response` (jsonb) guarda la respuesta cruda de la API.
- **Reenvío/bitácora (reuso sin cambios):** `external_webhook_deliveries` registra cada push de entrante (success/failed/skipped), igual que hoy.
- `api_keys`, cifrado y SSE se reutilizan tal cual.
- Migración nueva: `apps/web/db/migrations/000X_whatsapp_channel.sql` (número siguiente al último aplicado), ejecutada con `npm --workspace web run db:migrate`.

### OAuth / Embedded Signup (alta del tenant)
- **Frontend:** cargar el Facebook JS SDK e invocar Embedded Signup desde Connections:
  ```js
  FB.login(cb, {
    config_id: NEXT_PUBLIC_WHATSAPP_CONFIG_ID,
    response_type: "code",
    override_default_response_type: true,
    extras: { sessionInfoVersion: 3 }   // sin solutionID (modelo directo, no BSP)
  })
  ```
  Escuchar `window.addEventListener("message", …)` para capturar `phone_number_id` y `waba_id` de los eventos `WA_EMBEDDED_SIGNUP` (`FINISH`/`FINISH_ONLY_WABA`/`CANCEL`/`ERROR`). El `code` se entrega al backend (vía redirect a `/api/whatsapp/callback` o POST a un route handler).
- **Backend — nuevo cliente `apps/web/lib/whatsapp.ts`** (espejo de `lib/meta.ts`):
  - `exchangeCodeForToken(code)` → `GET https://graph.facebook.com/v23.0/oauth/access_token?client_id=NEXT_PUBLIC_META_APP_ID&client_secret=META_APP_SECRET&code=…` → token de negocio.
  - `registerPhoneNumber(phoneNumberId, token, pin)` → `POST /v23.0/{phone_number_id}/register` body `{ messaging_product:"whatsapp", pin }` (PIN de 6 dígitos del 2FA del número; generado/guardado por Resender).
  - `subscribeWabaApp(wabaId, token)` → `POST /v23.0/{waba_id}/subscribed_apps`.
  - `getPhoneNumbers(wabaId, token)` → `GET /v23.0/{waba_id}/phone_numbers` (para resolver E.164/display y validar).
  - `sendWhatsappMessage(phoneNumberId, token, payload)` → `POST /v23.0/{phone_number_id}/messages` (header `Authorization: Bearer <token>`).
  - `sendWhatsappTemplate(phoneNumberId, token, { name, language, components })` → mismo endpoint con `type:"template"`.
- **Rutas nuevas:** `apps/web/app/api/whatsapp/start/route.ts` (opcional, si se hace OAuth por redirect en vez de popup SDK) y `apps/web/app/api/whatsapp/callback/route.ts` (valida `state`/origen, intercambia `code`, registra número, suscribe WABA, persiste cifrado). Reflejan a `app/api/meta/{start,callback}`.

### Persistencia de la conexión
- Extender `apps/web/lib/pages/page-registry.ts` con `connectWhatsappNumber(...)` (o generalizar el connect para aceptar `channel`): upsert transaccional en `connected_pages` con `channel='whatsapp'`, cifra el token, guarda `waba_id`, `whatsapp_phone_e164`, `token_expires_at`, y aplica `PageOwnershipError` (un `phone_number_id` pertenece a un solo tenant).
- Reconexión idempotente del mismo tenant: refresca token, re-`register` (si aplica) y re-`subscribed_apps`.
- Resolvedor: `getActiveSourceByPhoneNumberId(phoneNumberId)` para mapear webhook → tenant.

### Entrada (webhook de WhatsApp)
- Ruta nueva `apps/web/app/api/whatsapp/webhook/route.ts`:
  - `GET` = verificación del reto (`hub.challenge`) con `WHATSAPP_VERIFY_TOKEN`.
  - `POST`:
    1. **Verifica `X-Hub-Signature-256`** (HMAC-SHA256 con `META_APP_SECRET`, `timingSafeEqual`) — **reusa el helper existente** del webhook de Meta.
    2. **Parsea** `object:"whatsapp_business_account"` → `entry[].changes[]` con `change.field === "messages"`. De `change.value`:
       - `metadata.phone_number_id` → resuelve fuente/tenant.
       - `messages[]` → mensajes entrantes (procesar `type:"text"`; texto/links). `contacts[].profile.name` → nombre.
       - `statuses[]` → callbacks de estado (`sent|delivered|read|failed`) → actualizar la fila saliente por `wamid` (`messages.status`, `error` si falla).
    3. **Idempotencia** por `wamid` (índice único parcial).
    4. **Ingiere** y dispara el **push no bloqueante** con `after()`.
    5. Devuelve **`200 {ok:true}` rápido** (misma filosofía que el webhook de Meta; si tardas o respondes error, Meta reintenta con backoff).
  - Parser y helpers en `apps/web/lib/inbound/whatsapp-webhook.ts` (`extractWhatsappInboundMessages`, `extractWhatsappStatuses`). No se mezcla con `meta-webhook.ts` (shape distinto), pero la verificación de firma se comparte.

### Ingestión y reenvío
- `apps/web/lib/inbound/whatsapp-ingestion.ts` (nuevo, espejo de `inbound-ingestion.ts`): resuelve fuente por `phone_number_id`, upsert de conversación (`unique(connected_page_id, contact_id)`), persiste el mensaje (idempotente por `wamid`), publica al SSE y arma el `pushJob`.
- `apps/web/lib/inbound/external-push.ts` (reuso, extendido): `buildInboundPushPayload` agrega `channel:"whatsapp"` y el contexto del mensaje, p. ej.:
  ```json
  {
    "channel": "whatsapp",
    "tenant": { "id": "..." },
    "source": { "id": "...", "channel": "whatsapp", "phoneNumberId": "1234567890", "wabaId": "9876543210", "name": "+52 55 ..." },
    "conversation": { "id": "...", "contactId": "5215555555555", "contactName": "Juan P." },
    "message": { "id": "wamid.HBg...", "direction": "inbound", "text": "Hola", "timestamp": "2026-06-17T...Z" }
  }
  ```
  Reusa `pushInboundMessage` (POST con timeout) y `recordDelivery`/`recordSkippedDelivery`.

### Envío (`/api/whatsapp/send`) — ventana de 24 h y plantillas
- Ruta nueva `apps/web/app/api/whatsapp/send/route.ts` (autenticada por API key opaca `Bearer`, mismo modelo que `/api/meta/send`). Body:
  - Sesión (texto libre): `{ phoneNumberId, to, reply, conversationId? }`.
  - Plantilla: `{ phoneNumberId, to, template: { name, language, variables? }, conversationId? }`.
  - Validaciones (reusar reglas de `/api/meta/send`): si `conversationId` viene, debe coincidir con `phoneNumberId`+`to`; si no, `400`.
- **Enforcement de ventana 24 h:** antes de enviar texto libre, calcular el último mensaje **entrante** de la conversación; si han pasado > 24 h, **rechazar** con error claro (p. ej. `409 outside_24h_window`) indicando que se requiere `template`. Si se manda `template`, no se aplica la restricción de ventana.
- Resolver el token server-side (descifrar), llamar a `sendWhatsappMessage`/`sendWhatsappTemplate`, **persistir el saliente** en éxito y fallo (`status` distingue), guardando `wamid` y `provider_response`. (Se decide ruta nueva en vez de extender `/api/meta/send` por la diferencia de payload de plantillas; la **misma API key** del tenant sirve para ambos canales.)
- **Plantillas:** se soporta **enviar** una plantilla ya aprobada por nombre. La **creación/gestión** de plantillas en UI queda _Out of Scope_ (se hace en WhatsApp Manager); para el video de App Review de `whatsapp_business_management`, crear una plantilla desde WhatsApp Manager es suficiente.

### Refresh de tokens
- Los tokens de **system user** de negocio normalmente **no expiran**; si se usara un token con expiración, mismo patrón que Instagram/Google: refresco on-demand antes de enviar si `token_expires_at` está vencido/próximo, y un **cron opcional** (`apps/web/app/api/whatsapp/refresh-tokens/route.ts`, protegido por `CRON_SECRET`) para mantenerlos calientes. Si `token_expires_at IS NULL`, no se refresca.
- Manejo del **error 190** (token inválido/caduco): persistir el error y (recomendado) notificar al admin del tenant para re-conectar (gotcha heredado de Messenger en `fb_requirements.md`).

### Configuración / secretos
- Variables de entorno nuevas (agregar a `turbo.json` `globalEnv`, `apps/web/.env` y `README.md`):
  - `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` — `config_id` del Facebook Login for Business para el Embedded Signup de WhatsApp.
  - `WHATSAPP_VERIFY_TOKEN` — verify token del webhook de WhatsApp (GET challenge).
  - (opcional) `WHATSAPP_DEFAULT_PIN` — PIN de 6 dígitos por defecto para `register` si no se genera por número.
  - (opcional) `CRON_SECRET` — protege la ruta de refresh (reuso si ya existe).
- Se **reutilizan**: `NEXT_PUBLIC_META_APP_ID`/`META_APP_ID`, `META_APP_SECRET` (firma del webhook + `client_secret` del exchange), `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL`, `API_KEY_PEPPER`, `AUTH_SECRET`.

### UI
- En Connections: botón **"Conectar WhatsApp"** que lanza el Embedded Signup (FB SDK). Listar los números conectados junto a páginas/cuentas con un **badge de canal** "WhatsApp", el mismo editor de `webhookUrl` y la acción de desconectar (con confirmación, conservando historial).
- En Messages: badge de canal "WhatsApp" en conversaciones e hilos; semántica visual de dirección/estado igual que hoy (entrante verde, saliente amarillo, fallo con indicador de error).

### Principios
- Route handlers y páginas se mantienen como capas delgadas sobre los deep modules (igual que MVP/Instagram/Google).
- No se rompen Messenger ni Instagram: `channel` default `'messenger'`, rutas `/api/meta/*` e `/api/instagram/*` intactas; el webhook de WhatsApp vive en su propia ruta aunque comparta el verificador de firma.

## Testing Decisions

- `lib/whatsapp.ts`: `exchangeCodeForToken` (mock fetch); `registerPhoneNumber` arma `{messaging_product,pin}`; `subscribeWabaApp` POSTea a `/{waba}/subscribed_apps`; `sendWhatsappMessage` usa header Bearer y shape `text`; `sendWhatsappTemplate` arma `type:"template"`; manejo de errores por paso (incl. error 190).
- `lib/inbound/whatsapp-webhook.ts`:
  - Verificación de firma compartida: firma válida pasa; inválida → `401`/descartado.
  - `extractWhatsappInboundMessages`: parsea `object:"whatsapp_business_account"` → `changes[].value.messages[]`, toma `wa_id`, `profile.name`, texto; ignora tipos no soportados (media) de forma segura.
  - `extractWhatsappStatuses`: mapea `statuses[]` a `sent|delivered|read|failed` por `wamid`.
- Ruta `/api/whatsapp/webhook`: GET challenge con verify token correcto/incorrecto; POST con firma inválida → rechazo; idempotencia (dos entregas del mismo `wamid` → un insert y un push); push no bloqueante cuando el externo falla (no rompe el 200); 200 rápido en éxito.
- Ingestión: resolución `phone_number_id` → tenant; upsert de conversación; persistencia aunque no haya `webhookUrl` (registro `skipped`); `contact_name` poblado desde `profile.name`.
- Envío: dentro de ventana 24 h → texto libre OK; fuera de ventana sin template → `409 outside_24h_window`; con template → envía aunque esté fuera de ventana; persistencia en éxito y fallo; coincidencia `conversationId`↔`phoneNumberId`+`to`.
- Propiedad exclusiva: bloquear `phone_number_id` ya conectado por otro tenant (`PageOwnershipError`); reconexión idempotente del mismo tenant refresca token y re-suscribe.
- Payload de push externo: incluye `channel:"whatsapp"` y los bloques `source`/`conversation`/`message`.
- Un test de integración por ruta nueva (`/api/whatsapp/callback`, `/api/whatsapp/webhook`, `/api/whatsapp/send`) que verifique cableado y códigos de estado.

## Out of Scope (esta fase)

- **Mensajes multimedia ricos** (imágenes, audio, documentos, ubicación, botones interactivos/list messages). Solo texto/links, igual que Instagram.
- **Creación/gestión de plantillas en UI** (`message_templates`). Se hace en WhatsApp Manager; Resender solo **envía** plantillas ya aprobadas por nombre.
- **Flujos avanzados de WhatsApp:** Flows, catálogo/commerce, pagos, Calling API, listas de difusión/marketing masivo.
- **Métricas de calidad/quality rating y messaging tiers** automatizados (1K→10K→100K…). Se documentan; el error de Meta se registra en la bitácora cuando ocurra.
- **Rate limiting propio** para los límites de la Cloud API (se documenta; se registra el error de Meta).
- **Verificación de negocio del tenant:** Resender no automatiza la Business Verification del cliente; su WABA puede arrancar con límites de mensajería hasta que el propio tenant verifique su negocio.
- **On-Premises API** (descontinuada por Meta) y **modelo BSP** (descartado en el ADR).

## Further Notes / Riesgos

- **Gate de App Review (bloqueante para producción):** para operar números de **otros** negocios se necesita **Advanced Access** a `whatsapp_business_messaging` y `whatsapp_business_management`, lo que exige **Business Verification + 2FA** y **App Review** con dos screencasts. La **Business Verification puede tardar semanas** → iniciarla antes de terminar el código. Hasta tener Advanced Access + app en **Live**, el Embedded Signup real no funciona para clientes (solo números/usuarios de prueba en Development).
- **⚠️ Riesgo de modelo de producto (leer sí o sí, heredado de `fb_requirements.md`):** la guía de Meta asume una experiencia interactiva; Resender responde **vía sistema externo**. El revisor **enviará un WhatsApp al número y esperará respuesta**. Si la cuenta de prueba no tiene una **automatización demo** conectada respondiendo (dentro de la ventana de 24 h), verá silencio → **rechazo**. **Mitigación obligatoria:** dejar una automatización demo (n8n) conectada que responda cualquier mensaje y documentarlo en las notas del revisor (*"envía la palabra X → recibes respuesta automática"*). El **video de `whatsapp_business_messaging`** debe mostrar **la interfaz del negocio** (Connections/Messages de Resender), no la del consumidor, y el flujo end-to-end (alta vía Embedded Signup → llega mensaje → respuesta automática).
- **Bloqueadores de plataforma COMPARTIDOS con Messenger/Instagram** (de `fb_requirements.md`, hoy **inexistentes**; una sola implementación cubre los tres canales): **política de privacidad pública** (`/privacy`), **método de eliminación de datos** (`/api/meta/data-deletion` con `signed_request` o opción "eliminar cuenta"), **Términos de Servicio para tenants** (`/terms`, obligación como Tech Provider), **email de reporte de vulnerabilidades** en el footer, **acceso de prueba para el revisor** (la app está tras login propio), y ajustes de panel (app icon 1024×1024 sin marcas, categoría, email de notificaciones). Son prerrequisito del envío de App Review.
- **No pedir los permisos de WhatsApp hasta tener el canal construido y una demo respondiendo.** Misma regla que `fb_requirements.md` aplica a Instagram: el revisor prueba el flujo real. Orden de reviews recomendado: (1) Messenger `pages_messaging` (ya casi listo, solo faltan los bloqueadores compartidos), (2) WhatsApp, (3) Instagram.
- **Registrar el número y suscribir el WABA son obligatorios y "fallan en silencio" si se omiten:** sin `/{phone}/register` el número no envía; sin `/{waba}/subscribed_apps` la app no recibe webhooks aunque el callback esté configurado. Hacer ambos explícitos en el `callback` y verificarlos.
- **App Secret compartido:** el webhook de WhatsApp se firma con el **mismo** `META_APP_SECRET` de la app (no hay secret separado como en Instagram-con-Instagram-Login). Confundirlo es el error de config más probable.
- **Ventana de 24 h:** calcular la ventana desde el último mensaje **entrante** (no desde cualquier mensaje). Fuera de ella, solo plantillas aprobadas; intentar texto libre devuelve error de Meta.
- **SSE single-process:** `lib/message-store.ts` es buffer en memoria de un solo proceso; vale para UI en vivo pero no es bus durable (igual que el MVP). La durabilidad la dan `messages` + `external_webhook_deliveries`.
- **developers.facebook.com es una SPA JS** → WebFetch no lee el cuerpo. Validar shapes exactos (Embedded Signup events, webhook payload, `register`) contra el entorno real / Graph API Explorer antes de cerrar parsers.

---

# Guía de configuración en Meta (lo que haces tú)

Esta es la parte manual; el código de arriba asume que estos pasos quedaron hechos. Hay tres bloques: **(A) hacerte Tech Provider** (gate de Meta, puede tardar semanas), **(B) montar la Meta App + producto WhatsApp + Embedded Signup**, y **(C) cumplimiento de plataforma compartido**.

## Bloque A — Convertirte en Tech Provider (one-time, puede tardar semanas)

> Sin Advanced Access aprobado + app en Live, el Embedded Signup real no funciona para clientes.

1. **Business Manager:** ten un portfolio de negocio, activa **2FA** y completa **Business Verification** (varía por región, puede tardar semanas — empezar ya).
2. **Self Sign-up:** registra un número de WhatsApp **propio** de prueba para desarrollar/probar en modo Development.
3. **App Review** para `whatsapp_business_messaging` y `whatsapp_business_management` (Advanced Access):
   - Descripción de uso por permiso, declarando que eres **technology provider** y cómo gestionas números/plantillas (`management`) y envías/recibes (`messaging`) en nombre de otros negocios.
   - **2 screencasts:** (a) `messaging` → tu app (interfaz del **negocio**, no del consumidor) enviando un WhatsApp y la app de WhatsApp recibiéndolo, end-to-end; (b) `management` → crear/gestionar una plantilla en WhatsApp Manager.
   - Notas del revisor con **credenciales de prueba** + frase de activación de la **automatización demo** (ver riesgo de modelo de producto).
4. **Access Verification** post-aprobación (~5 días hábiles) si Meta lo solicita.

## Bloque B — Meta App, producto WhatsApp y Embedded Signup

### Paso 1 — Meta App
1. Usa **una** Meta App tipo Business (la misma que Messenger, agregando el producto WhatsApp). Copia **App ID** → `NEXT_PUBLIC_META_APP_ID` y **App Secret** → `META_APP_SECRET` (ya en uso por Messenger).
2. Agrega el producto **WhatsApp**; acepta términos.

### Paso 2 — Webhook de WhatsApp
1. WhatsApp → Configuration → **Webhook**: Callback URL `https://<TU_APP_URL>/api/whatsapp/webhook`, Verify Token → `WHATSAPP_VERIFY_TOKEN`.
2. Suscribe el campo **`messages`** del webhook. (La suscripción **por WABA** la hace el código vía `subscribed_apps`.)

### Paso 3 — Facebook Login for Business (Embedded Signup)
1. Crea una **Login Configuration** con la variación **"WhatsApp Embedded Signup"**, token tipo **system-user**, asegurando el asset **WhatsApp accounts** y el permiso `whatsapp_business_management`. Copia el **Configuration ID** → `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`.
2. En Facebook Login for Business → Settings: habilita Client/Web OAuth login, Enforce HTTPS, Embedded Browser OAuth, Strict Mode, Login con JS SDK. Agrega tu dominio a **Valid OAuth Redirect URIs** y **Allowed Domains for the JS SDK** (HTTPS, sin wildcards).

### Paso 4 — Variables de entorno en el software
Pon en `apps/web/.env` (y en tu hosting):
```bash
NEXT_PUBLIC_META_APP_ID="<App ID>"          # reuso (Messenger)
META_APP_SECRET="<App Secret>"              # reuso: firma webhook + client_secret del exchange
NEXT_PUBLIC_WHATSAPP_CONFIG_ID="<Config ID del Embedded Signup>"
WHATSAPP_VERIFY_TOKEN="<string aleatorio>"
# opcionales:
WHATSAPP_DEFAULT_PIN="<6 dígitos>"
CRON_SECRET="<string aleatorio>"
# Reutilizadas (ya existen):
APP_URL="https://<tu-origen-publico>"
TOKEN_ENCRYPTION_KEY="<ya configurado>"
DATABASE_URL="<ya configurado>"
```

### Paso 5 — Pasar la app a Live
Con App Review aprobado, pon la Meta App en **Live** y usa URLs de producción en Facebook Login. (En Development solo funcionan números/usuarios de prueba.)

## Bloque C — Cumplimiento de plataforma (compartido con Messenger/Instagram)

> Estos son prerrequisito del envío de App Review en **cualquier** canal. Hoy **no existen** (ver `fb_requirements.md`). Una sola implementación cubre los tres canales.

1. **`/privacy`** — política de privacidad pública (sin geobloqueo, accesible a crawlers), explica datos tratados y **cómo solicitar su eliminación**; publicar la URL en el panel.
2. **Eliminación de datos** — `/api/meta/data-deletion` (valida `signed_request`, borra datos del tenant, devuelve `{url, confirmation_code}`) **o** opción "eliminar mi cuenta" + página de instrucciones.
3. **`/terms`** — Términos de Servicio que prohíben usos indebidos a los tenants (obligación de Tech Provider).
4. **Email de seguridad** en el footer (reporte de vulnerabilidades).
5. **Ajustes de panel:** app icon **1024×1024** sin marcas, categoría precisa, email de notificaciones, publicar la página de Facebook asociada.

## Checklist de validación end-to-end (cuando haya acceso aprobado)
1. Conectar WhatsApp desde Connections vía Embedded Signup → aparece el número con badge "WhatsApp"; en BD quedan `phone_number_id`, `waba_id`, token cifrado.
2. Verificar que el `callback` ejecutó `register` (número activo) y `subscribed_apps` (app suscrita al WABA).
3. Enviar un WhatsApp **al** número de prueba → llega `POST /api/whatsapp/webhook`, se persiste en `messages` con `contact_name` del perfil y aparece en Messages.
4. Si hay `webhookUrl` → el sistema externo recibe el payload con `channel:"whatsapp"` y los bloques `source`/`conversation`/`message`.
5. Responder dentro de 24 h vía `POST /api/whatsapp/send` (texto libre) → llega al cliente, se persiste `sent`, y los `statuses` actualizan a `delivered`/`read`.
6. Intentar texto libre fuera de 24 h → `409 outside_24h_window`; reintentar con una plantilla aprobada → se entrega.
7. Reentregar el mismo webhook (mismo `wamid`) → no se duplica el mensaje ni el push (idempotencia).
8. Desconectar el número → deja de enviar/recibir; el historial en `messages`/`conversations` se conserva.
