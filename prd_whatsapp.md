# PRD — WhatsApp Fase 1: Tech Provider, Embedded Signup, Coexistence y multimedia

> **Estado:** en implementación. El slice 1 (contratos + migración) está completo; ver «Estado de implementación».
> **Última validación documental:** 11 de agosto de 2026. **Última actualización de estado:** 13 de agosto de 2026.
> **Decisión vigente:** integración directa con WhatsApp Cloud API como Tech Provider; no usar un BSP. Ver `docs/adr/0001-whatsapp-direct-cloud-api-tech-provider.md`.

## Estado de implementación

### Hecho — slice 1: contratos y modelo de datos (13 de agosto de 2026)

- **`packages/contracts`**: `whatsapp` en `ChannelSchema`; `MessageSchema` con `type` (enum de 13 tipos), `text` nullable, `content` (union discriminada, `generic_event` conserva tipos desconocidos), `attachments[]`, `origin`, `historical`, `deliveryStatus` y `replyTo`; `PageSchema` con `wabaId`/`phoneE164`/`onboardingMode`/`whatsappStatus` (planos, null fuera del canal, patrón `username`); `SendMessageSchema` como union discriminada por `type` (texto, media por `mediaId`, ubicación, reacción, contactos); DTOs de media uploads; errores `customer_service_window_closed` y `media_not_ready`; RPC `connectWhatsappNumber` en el contrato.
- **Migración `apps/web/db/migrations/0015_whatsapp_channel_and_media.sql`** (el 0014 que menciona este PRD ya estaba ocupado por `0014_inbox_labels.sql`): check de `channel` con `whatsapp`, columnas WABA en `connected_pages`, columnas nuevas en `messages` (`text` ahora nullable), `conversations.last_inbound_at` con backfill, tablas `message_attachments`, `media_uploads` y `whatsapp_media_jobs`, índice de dedupe de echoes/history scoped por `origin`. Validada de 0001→0015 sobre PGlite con datos legacy; **pendiente de aplicarse en los ambientes reales** (`npm run db:migrate`, la corre Arturo).
- **Shims para mantener todo verde**: `sendMessage` rechaza `type !== "text"` en la puerta (el pipeline de media llega después); proyecciones de `repository.ts` pueblan los campos nuevos con fallbacks (las filas legacy derivan `origin` por `direction`); ambos workers mantienen `last_inbound_at` en la ingesta entrante desde ya; el entrypoint RPC expone `connectWhatsappNumber` como stub que rechaza hasta que exista Embedded Signup; snapshot OpenAPI regenerado.

Decisiones tomadas durante el slice (vigentes para los siguientes):

- **Upload de media saliente por el Worker**: `PUT /v1/media/uploads/{mediaId}/complete` no cambia, pero los bytes suben vía `PUT /v1/media/uploads/{mediaId}/content` autenticado con la API key y el Worker streamea a R2 por binding. Sin URLs prefirmadas de subida ni credenciales S3.
- `MessageSchema` sigue **sin** exponer `channel` (decisión documentada en `api.ts`); el canal se resuelve por `pageId`.
- Un `caption` enviado en `audio`/`sticker` se stripea en silencio (zod stripea llaves no declaradas en toda la API; `zod-to-openapi` no soporta `z.never()` para prohibirlo).
- El dedupe de echoes/history es un unique parcial sobre `(connected_page_id, meta_message_id)` con `direction='outbound' and origin in ('business_app','history')` para no chocar con datos legacy de Messenger.

### Pendiente (orden sugerido)

1. `whatsapp-client.ts` + `META_GRAPH_VERSION` centralizada (hoy `v23.0` está hardcodeada en `client.ts` e `instagram-client.ts`).
2. Webhook `GET|POST /webhooks/meta/whatsapp` + parsers de dominio (`messages[]`, `statuses[]`, `history`, `smb_app_state_sync`, `smb_message_echoes`). Ningún canal parsea `statuses` hoy.
3. Binding R2 `WHATSAPP_MEDIA` + endpoints `/v1/media/*` + jobs de descarga (la tabla `whatsapp_media_jobs` ya existe).
4. Ventana de 24 h en `/v1/messages` usando `conversations.last_inbound_at` (ya mantenida) + `409 customer_service_window_closed`.
5. RPC `connectWhatsappNumber` real + Embedded Signup UI (ojo: el repo eliminó a propósito el FB JS SDK; Messenger/IG usan redirect OAuth server-side, Embedded Signup exige reintroducir `FB.login` + popup + `postMessage`) + Coexistence.
6. UI Inbox/Connections, páginas legales (hoy obsoletas: dicen Vercel y solo-Messenger) y paquete de App Review.

## Resumen ejecutivo

Esta fase incorpora WhatsApp como tercer canal de Resender y deja el producto listo para solicitar Advanced Access, App Review y Access Verification como Tech Provider.

Incluye dos formas de conectar un número:

1. **Onboarding estándar:** número nuevo o exclusivo para WhatsApp Cloud API.
2. **Coexistence:** número que ya opera en WhatsApp Business App y seguirá utilizándose simultáneamente desde la aplicación móvil y Cloud API.

Incluye mensajería bidireccional de texto y los tipos multimedia comunes soportados por Cloud API. **No incluye envío ni gestión de plantillas.** Resender solo enviará mensajes dentro de la ventana de atención de 24 horas abierta por un mensaje del usuario. Fuera de esa ventana responderá con un error de dominio explícito y no llamará a Meta.

El desarrollo y las pruebas comienzan con WABA/números propios. Conectar negocios externos en producción queda bloqueado hasta que Meta apruebe los permisos y la verificación de Tech Provider.

## Objetivo de la fase

Al terminar esta fase, un tenant debe poder:

- Conectar un número nuevo mediante Embedded Signup estándar.
- Conectar un número existente de WhatsApp Business App mediante Coexistence cuando Meta lo considere elegible.
- Recibir, conservar, visualizar y reenviar a su webhook mensajes de texto y multimedia.
- Responder por la API pública con texto y multimedia dentro de la ventana de 24 horas.
- Ver estados de envío, entrega, lectura y fallo.
- Conservar una bitácora unificada con Messenger e Instagram.
- Desconectar el número sin borrar el historial.
- Eliminar su cuenta y todos sus objetos multimedia.

Resender debe quedar además con una cuenta demo, documentación y evidencias suficientes para App Review y Access Verification.

## Alcance funcional

### Incluido

- WhatsApp Cloud API directa contra `graph.facebook.com`.
- Embedded Signup estándar.
- Embedded Signup especial para Coexistence.
- Uno o varios números por WABA, sujetos a límites de plan.
- Mensajes entrantes:
  - texto y enlaces;
  - imagen;
  - audio y nota de voz;
  - video;
  - documento;
  - sticker;
  - contacto;
  - ubicación;
  - reacción;
  - respuestas de botones e interacciones;
  - contexto de reply/forward;
  - eventos `system`, `order` y tipos desconocidos conservados como eventos genéricos, sin descartarlos.
- Mensajes salientes dentro de la ventana de 24 horas:
  - texto y enlaces;
  - imagen;
  - audio y nota de voz;
  - video;
  - documento;
  - sticker;
  - contacto;
  - ubicación;
  - reacción;
  - replies y mensajes interactivos que Cloud API permita dentro de la sesión.
- Descarga inmediata de medios entrantes desde Meta y almacenamiento privado en Cloudflare R2.
- Carga previa de medios salientes a R2 y posterior envío a Meta por media ID.
- Estados `sent`, `delivered`, `read`, `failed` y `deleted` cuando Meta los emita.
- Historial, contactos y mensajes enviados desde WhatsApp Business App en Coexistence.
- Actualización de Connections, Messages, API pública, OpenAPI, webhooks externos, privacidad, términos y eliminación de datos.
- Paquete de App Review: cuenta revisora, WABA/número de prueba, automatización demo, instrucciones y screencasts.

### Fuera de alcance

- Envío, creación, edición o listado de plantillas de WhatsApp.
- Inicio de conversaciones por API cuando no existe una ventana de atención abierta.
- Campañas, broadcasts o marketing masivo.
- Catálogo/commerce como experiencia de producto, aunque un `order` entrante se conserve como evento genérico.
- WhatsApp Flows.
- Pagos regionales.
- Calling API, llamadas, grupos, Channels y Status.
- Gestión automatizada de quality rating o messaging tiers.
- Verificación del negocio de cada tenant.
- On-Premises API.
- Modelo BSP, `solutionID` o línea de crédito de Resender para pagar los mensajes de sus clientes.

## Regla explícita sobre plantillas

Las plantillas **no son obligatorias** para recibir mensajes ni para responder con mensajes libres dentro de las 24 horas posteriores al último mensaje entrante del usuario.

En esta fase:

- El usuario final debe iniciar o reabrir la conversación.
- La ventana se calcula desde el último mensaje entrante real, no desde un mensaje saliente, un status o un mensaje histórico importado.
- Si no existe una ventana abierta, cualquier intento de envío responde `409 customer_service_window_closed` con `requiresTemplate: true` y `templateSendingSupported: false`.
- Resender no intenta enviar a Meta cuando la ventana está cerrada.
- La demo de App Review comienza con un mensaje enviado por el revisor al número de prueba y responde dentro de esa ventana.
- El permiso `whatsapp_business_management` se demuestra mediante onboarding, lectura de assets y suscripción del WABA; no mediante gestión de plantillas.

Agregar plantillas será una fase posterior y no debe condicionar este diseño.

## Flujos de extremo a extremo

### A. Número nuevo o exclusivo para Cloud API

```text
Connections → Conectar WhatsApp → Embedded Signup estándar
  → FINISH entrega code + waba_id + phone_number_id
  → backend intercambia code y valida assets autorizados
  → registra el número con /{phone_number_id}/register
  → suscribe la app con /{waba_id}/subscribed_apps
  → persiste token cifrado y onboarding_mode='standard'
  → muestra el número activo en Connections
```

El callback solo persiste la conexión después de confirmar registro, suscripción y propiedad. Una reconexión del mismo tenant es idempotente; otro tenant no puede tomar el mismo `phone_number_id`.

### B. Número existente mediante Coexistence

```text
Connections → Conectar WhatsApp existente
  → Embedded Signup con el feature type oficial de Business App onboarding
  → cliente completa la vinculación desde WhatsApp Business App
  → backend valida code + waba_id + phone_number_id
  → suscribe app y campos de Coexistence
  → persiste onboarding_mode='coexistence'
  → inicia inmediatamente sync autorizada de contactos e historial
  → procesa history, smb_app_state_sync y smb_message_echoes por cola
```

Reglas:

- Coexistence solo aplica a WhatsApp **Business App**, no a una cuenta personal de WhatsApp.
- La UI debe explicar que disponibilidad, países, versión de la app y dispositivos compatibles dependen de Meta.
- El flujo estándar y el flujo Coexistence comparten UI base, pero no comparten ciegamente el paso de registro; cada uno ejecuta exactamente los pasos que Meta exija para ese modo.
- La sincronización se solicita inmediatamente después del onboarding y registra progreso/fallo recuperable.
- El historial importado se persiste con `historical=true` y **no** se reenvía al webhook externo para evitar disparar automatizaciones sobre conversaciones antiguas.
- Los mensajes nuevos enviados desde Business App llegan como echoes, se persisten como `direction='outbound'`, `origin='business_app'` y sí se reenvían al webhook externo.
- Contact sync actualiza identidad/nombre, pero no crea entregas externas por sí solo.
- Todos los eventos se deduplican por identificador de Meta y fuente.

### C. Mensaje entrante

```text
Meta POST /webhooks/meta/whatsapp
  → verifica X-Hub-Signature-256 sobre body crudo
  → valida object='whatsapp_business_account'
  → resuelve tenant por phone_number_id
  → persiste mensaje/status/evento de forma idempotente
  → texto: crea inmediatamente el outbox de entrega externa
  → media: crea attachment pending + job durable de descarga
  → responde 200 rápido a Meta
  → cola descarga media, valida y guarda en R2 privado
  → marca attachment available o failed
  → crea y ejecuta entrega al webhook del tenant
```

Si el medio no puede recuperarse después de los reintentos, el mensaje no desaparece: queda registrado con `attachment.status='failed'` y el webhook externo recibe el evento con el error correspondiente.

### D. Mensaje saliente

```text
Sistema externo
  → para media: crea upload, sube a R2 y completa upload
  → POST /v1/messages con API key + Idempotency-Key
  → Resender valida tenant, fuente, destinatario y ventana de 24 h
  → texto: envía payload directo a /{phone_number_id}/messages
  → media: sube objeto privado a /{phone_number_id}/media y envía por media ID
  → persiste wamid y respuesta del proveedor
  → statuses posteriores actualizan delivery_status
```

No se aceptan URLs arbitrarias del cliente como sustituto de una carga de media en esta fase. Esto evita SSRF, enlaces caducados y mensajes cuyo archivo cambia después de calcular la idempotencia.

## Arquitectura objetivo

La arquitectura vigente del repo manda sobre las rutas antiguas del PRD:

- `apps/api` es la fuente de verdad para contratos HTTP, aplicación, proveedor, webhooks, persistencia, Queue y observabilidad.
- `packages/contracts` define DTOs, RPC y OpenAPI compartidos.
- `apps/web` contiene sesión, UI y el launcher de Embedded Signup; llama a `apps/api` mediante Service Binding/RPC.
- Una ruta de Next solo puede mantenerse como adaptador temporal si existe una callback URL de producción todavía apuntando a `resender.dev`; la lógica de dominio no se duplica allí.
- Las migraciones siguen viviendo en `apps/web/db/migrations` y son consumidas por ambos Workers.

Rutas canónicas:

- `GET|POST /webhooks/meta/whatsapp` en `apps/api` para Meta.
- `POST /v1/messages` para enviar todos los canales, discriminando por la fuente conectada.
- `POST /v1/media/uploads` para reservar una carga privada.
- `POST /v1/media/uploads/{mediaId}/complete` para confirmar contenido y metadata.
- `GET /v1/media/{mediaId}` para descarga autenticada por API key.
- RPC `connectWhatsappNumber` para finalizar Embedded Signup desde la sesión web.

## Decisiones de implementación

### Contratos compartidos

**Hecho** — ver «Estado de implementación». El plan original, como referencia. En `packages/contracts`:

- Extender `ChannelSchema` con `whatsapp`.
- Reemplazar `MessageSchema.type = 'text'` por un discriminated union estable.
- Mantener `text` como string para texto/caption y hacerlo nullable donde el tipo no tenga texto.
- Añadir `content` tipado para ubicación, contactos, reacción, interacción y eventos genéricos.
- Añadir `attachments[]` con:
  - `id` de Resender;
  - `kind`;
  - `mimeType`;
  - `filename` nullable;
  - `caption` nullable;
  - `sizeBytes` nullable;
  - `sha256` nullable;
  - `status` (`pending|available|failed|deleted`);
  - URL de descarga autenticada solo cuando esté disponible.
- Separar `status` interno (`received|sent|failed`) de `deliveryStatus` del proveedor (`accepted|sent|delivered|read|failed|deleted|null`).
- Añadir `origin` (`customer|resender_api|business_app|history|system`).
- Añadir `historical` y contexto de reply.
- Extender el fingerprint de idempotencia con tipo, contenido, media ID y versión/etag del objeto.

No deben exponerse tokens de Meta, claves R2, URLs temporales de Meta ni payloads crudos con datos innecesarios.

### Modelo de datos

**Hecho** en `apps/web/db/migrations/0015_whatsapp_channel_and_media.sql` (el número 0014 de este plan ya estaba ocupado). Lo que sigue era el plan original:

- Extender el check de `connected_pages.channel` con `whatsapp`.
- Añadir a `connected_pages`:
  - `waba_id text`;
  - `whatsapp_phone_e164 text`;
  - `onboarding_mode text check ('standard','coexistence')`;
  - `coexistence_status text` nullable;
  - `history_sync_status text` nullable;
  - reutilizar `token_expires_at`.
- Mantener el unique existente `(channel, meta_page_id)`; para WhatsApp `meta_page_id = phone_number_id`.
- Extender `messages`:
  - `message_type`;
  - `content jsonb`;
  - `origin`;
  - `historical boolean default false`;
  - `delivery_status`;
  - `reply_to_meta_message_id`;
  - permitir `text` nullable.
- Crear `message_attachments` con ownership por tenant, referencia al mensaje, media ID de Meta, key privada R2, metadata, estado y error.
- Crear `media_uploads` para cargas salientes reservadas, completadas, consumidas o vencidas.
- Crear `whatsapp_media_jobs` o una outbox equivalente para que descarga y entrega externa sean durables.
- Índices para `provider_media_id`, `r2_key`, jobs pendientes y eliminación por tenant.
- Mantener deduplicación por `(connected_page_id, meta_message_id)` tanto para mensajes vivos como para historia/echoes.

La desconexión conserva mensajes y R2. La eliminación de cuenta debe borrar tokens, filas y todos los objetos bajo el prefijo privado del tenant; si R2 falla, se registra un job de borrado recuperable y nunca se declara eliminación completa silenciosamente.

### Cliente WhatsApp

Crear `apps/api/src/infrastructure/meta/whatsapp-client.ts` con operaciones separadas y errores tipados:

- intercambio del code de Embedded Signup;
- validación de WABA/números compartidos;
- registro de número estándar;
- suscripción/desuscripción de WABA;
- inicio/seguimiento de sync de Coexistence;
- consulta y descarga de media entrante;
- upload de media a Meta;
- envío de payloads libres;
- tratamiento de error 190, permisos, rate limits y ventana cerrada.

La versión de Graph API debe estar centralizada/configurada y validada en startup. No se hardcodea `v23.0` en cada llamada.

### Embedded Signup y seguridad

En `apps/web`:

- Botón separado para número nuevo y número existente.
- Cargar Facebook JS SDK una sola vez.
- Generar correlación de sesión/nonce server-side.
- Usar `response_type: 'code'`, `override_default_response_type: true` y `sessionInfoVersion` vigente.
- Para Coexistence, usar el feature type oficial de Business App onboarding vigente al implementar.
- Validar estrictamente `event.origin`, tipo de evento, nonce y shape; no confiar solo en `postMessage`.
- Enviar al RPC únicamente code e identificadores capturados, nunca persistir tokens en browser/local storage.
- Registrar el paso exacto de fallo (`exchange`, `assets`, `register`, `subscribe`, `sync`, `persist`) sin exponer secretos.

### Webhook y Coexistence

Crear parsers puros en `apps/api/src/domain` para:

- `messages[]` y `statuses[]` estándar;
- `history`;
- `smb_app_state_sync`;
- `smb_message_echoes`;
- eventos de cuenta/calidad necesarios para detectar offboarding o conexión degradada.

El webhook:

- usa el mismo `META_APP_SECRET` para verificar HMAC, pero un `WHATSAPP_VERIFY_TOKEN` propio para el challenge;
- limita tamaño del body antes de parsear;
- responde 200 después de persistir/outbox, no después de descargar archivos ni llamar al webhook del tenant;
- ignora con métrica los WABA/números no conectados;
- no convierte tipos desconocidos en texto falso: los conserva como eventos genéricos;
- actualiza estados de forma monotónica para que un callback atrasado no rebaje `read` a `sent`.

### Multimedia y Cloudflare R2

Crear un bucket R2 **privado** por ambiente y binding `WHATSAPP_MEDIA` en `apps/api/wrangler.jsonc`.

Reglas:

- Keys con prefijo no adivinable por tenant/mensaje; nunca usar filename como path directo.
- Guardar metadata y ownership en Postgres; R2 contiene bytes, no es la fuente de autorización.
- Validar tipo declarado, MIME real permitido por Meta, tamaño, checksum y filename sanitizado.
- Usar la tabla vigente de tipos/tamaños de la versión soportada de Cloud API; mantenerla centralizada y cubierta por tests.
- Descargar media entrante inmediatamente: las URLs entregadas por Meta son temporales y no se persisten como URL final.
- El bucket no tiene acceso público ni `r2.dev` habilitado en producción.
- UI y API descargan mediante endpoint autenticado o URL prefirmada de vida corta emitida después de verificar ownership.
- Tratar URLs prefirmadas como bearer tokens y no incluirlas en logs ni almacenarlas en BD.
- Configurar lifecycle para uploads abandonados y temporales; los objetos asociados a mensajes siguen la política de retención del tenant.
- No cargar archivos completos en memoria cuando exista una ruta streaming segura; respetar límites de Workers y Meta.
- Los retries deben ser idempotentes: un mismo job no crea múltiples objetos ni múltiples pushes externos.

La guía de Cloudflare determina esta decisión: R2 es el almacenamiento de objetos, los Workers acceden por binding y las URLs prefirmadas solo conceden acceso temporal a un objeto concreto.

### Entrega al webhook externo

El payload común se amplía sin romper texto existente:

```json
{
  "channel": "whatsapp",
  "source": {
    "id": "uuid",
    "phoneNumberId": "123456789",
    "wabaId": "987654321",
    "onboardingMode": "coexistence"
  },
  "conversation": {
    "id": "uuid",
    "contactId": "5215555555555",
    "contactName": "Juan"
  },
  "message": {
    "id": "uuid",
    "providerMessageId": "wamid...",
    "direction": "inbound",
    "origin": "customer",
    "type": "document",
    "text": "Factura",
    "historical": false,
    "attachments": [
      {
        "id": "uuid",
        "kind": "document",
        "mimeType": "application/pdf",
        "filename": "factura.pdf",
        "sizeBytes": 12345,
        "status": "available",
        "downloadUrl": "https://api.resender.dev/v1/media/uuid"
      }
    ],
    "createdAt": "2026-08-11T12:00:00Z"
  }
}
```

`downloadUrl` requiere la misma API key del tenant. No contiene una firma pública permanente.

### API pública de salida

`POST /v1/messages` conserva API key e `Idempotency-Key` obligatoria.

Ejemplos conceptuales:

```json
{ "pageId": "uuid", "recipientId": "521...", "type": "text", "text": "Hola" }
```

```json
{
  "pageId": "uuid",
  "recipientId": "521...",
  "type": "document",
  "mediaId": "resender-media-uuid",
  "caption": "Tu factura"
}
```

Validaciones:

- `pageId` pertenece al tenant y es WhatsApp activo.
- `recipientId`, `conversationId` y contacto coinciden.
- Existe un mensaje entrante no histórico dentro de 24 horas.
- El upload está completo, pertenece al tenant, no expiró y su tipo coincide.
- El mismo upload no puede mutar después de calcular idempotencia.
- Un error de Meta se persiste y traduce sin esconder el payload seguro de diagnóstico.

### Estados y UI

Connections muestra:

- badge WhatsApp;
- número visible y WABA ID secundario;
- modo estándar o Coexistence;
- estado de token, suscripción y sync;
- editor de webhook URL;
- reconectar/desconectar;
- explicación de limitaciones de Coexistence.

Messages muestra:

- texto/caption;
- thumbnails y reproductores seguros para imagen, audio y video;
- filename/tamaño y descarga para documentos;
- ubicación, contacto, reacción y reply context;
- estado de media pendiente/fallida;
- origen API o Business App;
- estados `sent/delivered/read/failed` sin confundirlos con el estado interno.

## Requisitos de Meta y preparación de Tech Provider

Trabajo administrativo en paralelo desde el inicio:

1. Business Portfolio de AI Beat con 2FA y Business Verification.
2. Dominio `resender.dev` y correo corporativo verificables.
3. Meta App tipo Business propiedad del portfolio; producto WhatsApp agregado.
4. WABA y número propios de prueba.
5. Embedded Signup configurado para estándar y Coexistence.
6. Webhook público HTTPS y suscripción por WABA.
7. Advanced Access solicitado para los permisos que el dashboard vigente exija, incluyendo:
   - `business_management` para Embedded Signup;
   - `whatsapp_business_management` para WABA/assets/subscriptions;
   - `whatsapp_business_messaging` para envío/recepción.
8. App Review con cuenta revisora, instrucciones y screencasts.
9. Access Verification como Tech Provider.
10. App en Live antes de onboarding de negocios externos.

Business Verification, App Review, Access Verification y App Live son gates distintos. La fase de ingeniería puede terminar con la solicitud enviada; el rollout público sigue bloqueado hasta recibir aprobación.

## Cumplimiento

Actualizar antes de App Review:

- `/privacy`: WhatsApp, WABA, números, perfiles, contenido, multimedia, Coexistence, R2, Cloudflare/Neon y retención. Eliminar referencias obsoletas a un producto solo Messenger o hosting en Vercel.
- `/terms`: opt-in, ventana de 24 h, prohibición de spam, responsabilidad por automatizaciones y contenido multimedia.
- `/data-deletion` y eliminación de cuenta: incluir WABA, tokens, mensajes y objetos R2.
- Footer: contacto legal y de seguridad.
- Dashboard Meta: icono, categoría, email, URLs públicas y método de eliminación.
- Cuenta revisora con suscripción/entitlements necesarios y datos no sensibles.

La automatización demo responde solo cuando el revisor inicia la conversación; no depende de plantillas.

## Estrategia de pruebas

### Unitarias

- Parsers de cada tipo estándar de mensaje y status.
- Parsers `history`, `smb_app_state_sync` y `smb_message_echoes`.
- Tipos desconocidos se conservan y nunca rompen el lote.
- State/nonce/origin de Embedded Signup.
- Diferencia entre registro estándar y Coexistence.
- Ventana abierta, borde exacto y ventana cerrada.
- Status monotónico y dedupe por `wamid`.
- Catálogo de MIME/tamaños y filename sanitizado.
- Fingerprint de idempotencia para texto y media.
- Ownership de número, media y conversación.

### Integración local/Worker

- Migración 0014 sobre fixture con Messenger e Instagram existentes.
- Callback/RPC estándar y Coexistence.
- Challenge y firma válida/inválida del webhook.
- Persistencia + outbox antes del 200.
- Media pendiente → R2 disponible → webhook externo.
- Retry/DLQ de descarga y de entrega externa sin duplicados.
- Upload reservado → PUT → complete → envío.
- Descarga autenticada y cross-tenant denegada.
- Account deletion elimina BD y R2 o deja job recuperable visible.
- OpenAPI snapshots y compatibilidad de mensajes de texto existentes.

### End-to-end real

Ejecutar con assets propios de Meta:

1. Conectar número estándar, enviar texto/media al número y responder dentro de 24 h.
2. Conectar WhatsApp Business App por Coexistence.
3. Confirmar sync de contactos/historial sin pushes históricos.
4. Enviar desde Business App y confirmar echo en Resender/webhook externo.
5. Enviar desde API y verificar aparición/entrega según comportamiento de Meta.
6. Probar imagen, audio/voz, video, documento y sticker en ambos sentidos.
7. Confirmar `sent/delivered/read/failed` por `wamid`.
8. Intentar envío fuera de ventana y obtener `409` sin llamada a Meta.
9. Desconectar/reconectar y comprobar que no se pierde historial.

## Criterios de aceptación de Fase 1

- [ ] `whatsapp` existe en BD, contratos, API, OpenAPI y UI sin regresiones en Messenger/Instagram.
- [ ] Onboarding estándar conecta un número propio de extremo a extremo.
- [ ] Coexistence conecta un número elegible y procesa sync/echoes.
- [ ] Texto y multimedia común funcionan en entrada, almacenamiento, webhook externo, UI y salida.
- [ ] Ningún mensaje desconocido se pierde silenciosamente.
- [ ] Media es privada, tenant-scoped, verificable y eliminable.
- [ ] Webhook responde rápido y el trabajo lento es durable.
- [ ] Idempotencia impide duplicar provider calls, mensajes, objetos y pushes.
- [ ] Ventana de 24 horas se aplica localmente; plantillas no están implementadas.
- [ ] Estados de entrega se reflejan de forma monotónica.
- [ ] Desconexión conserva historial; eliminación de cuenta incluye R2.
- [ ] Privacidad, términos y eliminación describen el comportamiento real.
- [ ] Existe cuenta demo, automatización, instrucciones y screencasts de revisión.
- [ ] Lint, typecheck, tests y build pasan.
- [ ] Pruebas reales estándar y Coexistence quedan documentadas con evidencia.

## Gates de lanzamiento

### Ingeniería completa

- Todos los criterios anteriores pasan con assets propios/test.
- Solicitud de permisos y paquete de revisión están listos o enviados.

### Producción multi-tenant

- Business Verification aprobada.
- Advanced Access aprobado.
- Access Verification como Tech Provider aprobada cuando Meta la exija.
- Meta App en Live.
- Smoke test con un negocio externo controlado.
- Runbook de revocación, offboarding, fallos de media y DLQ.

## Riesgos principales

- **Aprobación externa:** Meta puede cambiar nombres, pantallas y requisitos; registrar evidencia y fecha de cada configuración.
- **Coexistence no universal:** país, número, cuenta, versión o dispositivo pueden ser inelegibles. Mostrar error accionable y ofrecer onboarding estándar, sin prometer migración automática.
- **Eventos voluminosos:** history/media no pueden procesarse dentro del webhook; siempre usar outbox/Queue.
- **Media temporal de Meta:** descargar inmediatamente y no depender de la URL original.
- **Privacidad/costo:** R2 introduce retención de contenido sensible; ownership, borrado y lifecycle son parte del criterio de aceptación.
- **Doble canal de salida en Coexistence:** deduplicar echoes y distinguir `business_app` de `resender_api`.
- **Sin plantillas:** el producto no puede iniciar ni reabrir conversaciones; UI, API y marketing deben decirlo claramente.
- **Políticas de automatización:** Resender es infraestructura para casos de negocio; los términos deben prohibir spam y usos incompatibles con las políticas vigentes de WhatsApp.

## Variables y bindings

### `apps/api`

- `META_APP_ID` — reuso.
- `META_APP_SECRET` — reuso para firma/intercambio.
- `WHATSAPP_VERIFY_TOKEN` — nuevo secreto.
- `META_GRAPH_VERSION` — versión soportada centralizada.
- `TOKEN_ENCRYPTION_KEY` — reuso.
- `DATABASE_URL` — reuso.
- `WHATSAPP_MEDIA` — nuevo binding R2 privado, separado por ambiente.
- Queue/DLQ de procesamiento de media o binding equivalente según el diseño final de outbox.

### `apps/web`

- `NEXT_PUBLIC_META_APP_ID` — reuso.
- `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` — nuevo Configuration ID de Embedded Signup.
- Service Binding existente hacia `apps/api` — reuso.

No guardar PIN, App Secret, system-user token ni credenciales R2 en variables públicas o en el repositorio.

## Referencias vigentes

- Meta — WhatsApp Business Platform: https://www.postman.com/meta/whatsapp-business-platform/overview
- Meta — Embedded Signup: https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Meta — Cloud API Messages: https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages
- Meta — Webhook Messages Object: https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object
- Meta — Media: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3
- Meta — Customer service window/statuses: https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object
- Meta — Coexistence: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- Meta — Tech Providers: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Cloudflare — R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Cloudflare — R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare — R2 lifecycle rules: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
