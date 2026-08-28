# PRD — WhatsApp Fase 1: Tech Provider, Embedded Signup, Coexistence y multimedia

> **Estado:** listo para implementación.
> **Última validación documental:** 24 de agosto de 2026.
> **Decisión de canal:** integración directa con WhatsApp Cloud API como Tech Provider; no usar un BSP. Ver `docs/adr/0001-whatsapp-direct-cloud-api-tech-provider.md`.
> **Esta versión supersede la del 11 de agosto de 2026**, escrita contra una arquitectura que dejó de existir el 21 de agosto (`docs/adr/0012-un-solo-worker-next-sin-api-separada.md`) y contra supuestos de plataforma que se verificaron falsos. Ver [Cambios respecto de la versión del 11 de agosto](#cambios-respecto-de-la-versión-del-11-de-agosto).

## Resumen ejecutivo

Esta fase incorpora WhatsApp como tercer canal de Resender y deja el producto listo para solicitar Advanced Access, App Review y Access Verification como Tech Provider.

Incluye dos formas de conectar un número:

1. **Onboarding estándar:** número nuevo o exclusivo para WhatsApp Cloud API.
2. **Coexistence:** número que ya opera en WhatsApp Business App y seguirá utilizándose simultáneamente desde la aplicación móvil y Cloud API.

Incluye mensajería bidireccional de texto y los tipos multimedia comunes soportados por Cloud API. **No incluye envío ni gestión de plantillas.** Resender solo enviará mensajes dentro de la ventana de atención de 24 horas abierta por un mensaje del usuario. Fuera de esa ventana responderá con un error de dominio explícito y no llamará a Meta.

Todo el canal vive en **`apps/web`**, el único Worker desplegado. No hay backend separado, no hay `packages/contracts` y no hay rutas `/v1`.

El desarrollo y las pruebas comienzan con WABA/números propios. Conectar negocios externos en producción queda bloqueado hasta que Meta apruebe los permisos y la verificación de Tech Provider. Además, **el canal nace apagado para todas las cuentas** y se habilita una por una con un `update` explícito.

## Cambios respecto de la versión del 11 de agosto

Esta sección existe para que nadie implemente la versión anterior por inercia. Se conserva hasta el primer deploy del canal.

### Anulado porque la arquitectura cambió

| Lo que decía | Por qué se cae |
|---|---|
| «`apps/api` es la fuente de verdad» | `apps/api` y `packages/contracts` **se borraron** (ADR 0012, 21 ago). Solo quedan artefactos de build |
| Rutas `/v1/messages`, `/v1/media/*`, RPC `connectWhatsappNumber` | No existe el Worker que las servía. Las rutas reales son `/api/meta/whatsapp/*` |
| Extender `ChannelSchema` y `MessageSchema` en `packages/contracts` | El paquete no existe. Los tipos viven en `apps/web/lib` |
| Migración `0014_whatsapp_channel_and_media.sql` | `0014` ya la usó `inbox_labels`. La migración es **`0017`** |

### Anulado porque el supuesto era falso

| Lo que decía | El hecho |
|---|---|
| «No se aceptan URLs arbitrarias del cliente… evita SSRF» | Cloud API **sí** acepta media por `link` y la cachea 10 minutos. Y con `link` quien descarga es Meta, no Resender: no hay SSRF contra nosotros. Es exactamente lo que ya hace Messenger |
| «Doble canal de salida en Coexistence: deduplicar echoes y distinguir `business_app` de `resender_api`» | `smb_message_echoes` **solo** se dispara con la app. Los envíos por Cloud API no producen echo. Esa colisión no ocurre |
| «Inicia inmediatamente sync autorizada de contactos e historial» (como si llegara sola) | El sync **hay que pedirlo** con una llamada explícita, y hay **deadline duro de 24 h** o la conexión se pierde |
| Descargar toda la media del historial | El historial trae asset IDs **solo de los últimos 14 días** |
| `attachments[]` plural, tabla `message_attachments` | Un mensaje de Cloud API tiene **exactamente un** `type`. La cardinalidad N no la pide WhatsApp |
| `media_uploads` + tres endpoints de upload | Con media saliente por `link`, R2 queda **solo para entrada**. Toda esa superficie desaparece |
| `message_type` + `content jsonb` | Dejaría dos discriminadores en la misma fila. Se usa uno solo: `attachment_type` ampliado |

### Agregado porque no se sabía

- Deadline de 24 h para el history sync, y la llamada explícita que lo dispara.
- El historial llega en chunks desordenados, por fases, con `chunk_order` y `progress: 100` como señal de fin; cubre hasta **180 días**.
- Media asset IDs del historial: 14 días. Media IDs del webhook vivo: 7 días. URL de descarga: **5 minutos**.
- Un número en Coexistence tiene **techo fijo de 20 mensajes/segundo**.
- Requisitos formales de Coexistence: app **≥ 2.24.17**, suscripción a los **tres** campos antes de onboardear, Embedded Signup con **session logging**.
- Política de retención de media (180 días) y borrado de R2 al eliminar la cuenta, que antes estaban sin resolver.
- Bandera `users.whatsapp_enabled`, sin backfill.

## Objetivo de la fase

Al terminar esta fase, un tenant **con el permiso habilitado** debe poder:

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
- Embedded Signup especial para Coexistence, **completo**: history sync, `smb_app_state_sync` y `smb_message_echoes`.
- Uno o varios números por WABA. Cada número es una [Conexión] y ocupa un slot del plan, igual que una Página o una cuenta de Instagram.
- Bandera de permiso por cuenta (`users.whatsapp_enabled`), fail-closed, sin backfill.
- Mensajes entrantes:
  - texto y enlaces;
  - imagen, audio y nota de voz, video, documento, sticker;
  - contacto, ubicación, reacción;
  - respuestas de botones e interacciones;
  - contexto de reply;
  - eventos `system`, `order` y tipos desconocidos conservados sin descartarlos.
- Mensajes salientes dentro de la ventana de 24 horas: texto y adjunto por URL pública (`image`, `video`, `audio`, `file`), con el mismo body que Messenger.
- Descarga inmediata de medios entrantes desde Meta y almacenamiento privado en Cloudflare R2, con retención de 180 días.
- Estados `accepted`, `sent`, `delivered`, `read`, `failed` y `deleted` cuando Meta los emita, aplicados de forma monotónica.
- Historial, contactos y mensajes enviados desde WhatsApp Business App en Coexistence.
- Actualización de Connections, Inbox, API pública, docs públicas, webhooks externos, privacidad, términos y eliminación de datos.
- Borrado recuperable de los objetos R2 del tenant al eliminar la cuenta.
- Paquete de App Review: cuenta revisora, WABA/número de prueba, automatización demo, instrucciones y screencasts.

### Fuera de alcance

- Envío, creación, edición o listado de plantillas de WhatsApp.
- Inicio de conversaciones por API cuando no existe una ventana de atención abierta.
- Campañas, broadcasts o marketing masivo.
- Catálogo/commerce como experiencia de producto, aunque un `order` entrante se conserve.
- WhatsApp Flows.
- Pagos regionales.
- Calling API, llamadas, grupos, Channels y Status.
- Gestión automatizada de quality rating o messaging tiers.
- Verificación del negocio de cada tenant.
- On-Premises API.
- Modelo BSP, `solutionID` o línea de crédito de Resender para pagar los mensajes de sus clientes.
- **Carga de media saliente a Resender.** El cliente hospeda el archivo y manda su URL, como en Messenger.
- Retención de media configurable por tenant o por plan.

## Regla explícita sobre plantillas

Las plantillas **no son obligatorias** para recibir mensajes ni para responder con mensajes libres dentro de las 24 horas posteriores al último mensaje entrante del usuario.

En esta fase:

- El usuario final debe iniciar o reabrir la conversación.
- La ventana se calcula desde el último mensaje entrante **real del cliente final**: `direction='inbound'`, `historical=false`, `origin='customer'`. No la abre un saliente, ni un status, ni un mensaje histórico importado, ni un echo de Business App.
- Si no existe una ventana abierta, cualquier intento de envío responde `409 customer_service_window_closed` con `requiresTemplate: true` y `templateSendingSupported: false`.
- Resender no intenta enviar a Meta cuando la ventana está cerrada.
- La demo de App Review comienza con un mensaje enviado por el revisor al número de prueba y responde dentro de esa ventana.
- El permiso `whatsapp_business_management` se demuestra mediante onboarding, lectura de assets y suscripción del WABA; no mediante gestión de plantillas.

Agregar plantillas será una fase posterior y no debe condicionar este diseño.

## Hechos de plataforma verificados

Verificados contra la documentación de Meta el **24 de agosto de 2026**. Meta cambia estos números: si una implementación no coincide, gana la doc, y hay que actualizar esta tabla con la fecha.

### Media

| Tipo | Tamaño máximo | MIME aceptados |
|---|---|---|
| Imagen | 5 MB | `image/jpeg`, `image/png` (8-bit RGB/RGBA) |
| Video | 16 MB | `video/mp4`, `video/3gpp` (H.264 + AAC) |
| Audio | 16 MB | `audio/aac`, `audio/amr`, `audio/mpeg`, `audio/mp4`, `audio/ogg` (OPUS, mono) |
| Documento | 100 MB | `text/plain`, `application/pdf`, Word, Excel, PowerPoint |
| Sticker | 100 KB estático / 500 KB animado | `image/webp` |

### Plazos

| Qué | Cuánto dura |
|---|---|
| URL de descarga de media | **5 minutos** |
| Media ID recibido por webhook | 7 días |
| Media ID subido por API | 30 días |
| Media alojada en Meta | 30 días |
| Media por `link` cacheada por Meta | 10 minutos |

**Consecuencia de diseño:** R2 es la **única copia**. Lo que no se baje al momento, se pierde.

### Coexistence

- **Requisitos:** WhatsApp Business App **≥ 2.24.17**; ser Solution Partner o Tech Provider; webhook capaz de digerir los eventos; Embedded Signup con **session logging** habilitado; suscripción previa a los tres campos `history`, `smb_app_state_sync` y `smb_message_echoes`.
- **El sync no llega solo:** hay que pedirlo con una llamada a la SMB App Data API con `"sync_type": "history"`.
- **Deadline duro:** «you have 24 hours to synchronize their messaging history, otherwise they must be offboarded and they must complete the flow again».
- **El volumen lo decide el negocio:** «zero, one, or more history webhooks will be triggered, depending on if the business chose to share their messaging history with you». Un tenant en Coexistence con import vacío es un caso válido, no un fallo.
- **Forma del historial:** chunks que pueden llegar fuera de orden (`chunk_order`), por fases; la fase final cubre los días 90–180; `progress: 100` indica sync completo.
- **Media del historial:** asset IDs solo para mensajes de los **últimos 14 días**. El resto llega sin archivo recuperable.
- **Throughput:** un número en Coexistence tiene techo fijo de **20 mensajes/segundo**, no escala por messaging tier.
- **Echoes:** `smb_message_echoes` se dispara **solo** cuando el negocio manda desde la app o un companion device. Los envíos por Cloud API no producen echo.

### Sin verificar — a comprobar antes de comprometer fecha

1. **Elegibilidad por código de país.** Meta la habilita por región y no publica lista consolidada; la última expansión documentada en el changelog es India. Verificar en el App Dashboard, no suponer.
2. **«Must already be a Solution Partner or Tech Provider»** es ambiguo: puede significar «estás construyendo como Tech Provider» o «ya pasaste Access Verification». Si es lo segundo, Coexistence queda detrás del mismo gate que el rollout público.

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

El callback solo persiste la conexión después de confirmar registro, suscripción y propiedad. Una reconexión del mismo tenant es idempotente; otro tenant no puede tomar el mismo `phone_number_id` (unique `(channel, meta_page_id)`).

**Un número registrado aquí deja de ser candidato para Coexistence.** Para probar ambos flujos hacen falta dos números reales distintos.

### B. Número existente mediante Coexistence

```text
Connections → Conectar WhatsApp existente
  → Embedded Signup con el feature type de Business App onboarding
  → cliente completa la vinculación desde WhatsApp Business App
  → backend valida code + waba_id + phone_number_id
  → suscribe app y los tres campos de Coexistence
  → persiste onboarding_mode='coexistence',
              history_sync_status='not_requested'
  → encola job history_sync_request  ← el reloj de 24 h ya corre
  → job llama a la SMB App Data API con sync_type='history'
  → history_sync_status='requested'
  → llegan 0..N webhooks history, cada chunk se encola aparte
  → progress=100 → history_sync_status='complete'
```

Reglas:

- Coexistence solo aplica a WhatsApp **Business App**, no a una cuenta personal de WhatsApp.
- La UI debe explicar que disponibilidad, países, versión de la app y dispositivos compatibles dependen de Meta, y que el número tendrá techo de 20 mps.
- El flujo estándar y el flujo Coexistence comparten UI base pero **no** el paso de registro: un número de Coexistence no se registra con `/register`.
- **El sync se pide, no se espera.** Si el job agota reintentos, `history_sync_status='failed'` y Connections lo muestra como estado accionable, no como detalle.
- Si pasan 24 h sin `progress: 100`, `history_sync_status='expired'`: la conexión hay que rehacerla desde el Embedded Signup. La UI lo dice con esas palabras.
- El historial importado se persiste con `historical=true` y **no** se reenvía al webhook externo, para no disparar automatizaciones sobre conversaciones antiguas.
- El historial **no consume cuota**. Ver [Cuota y facturación](#cuota-y-facturación).
- El historial **no abre la ventana de 24 h**.
- Los mensajes nuevos enviados desde Business App llegan como echoes, se persisten como `direction='outbound'`, `origin='business_app'`, **sí** se reenvían al webhook externo y **sí** consumen cuota.
- La media del historial de más de 14 días llega sin asset id: se persiste con `attachment_status='unavailable'` y no se encola descarga.
- Contact sync actualiza identidad/nombre, pero no crea entregas externas por sí solo.
- Todos los eventos se deduplican por `(connected_page_id, meta_message_id)`.

### C. Mensaje entrante

```text
Meta POST /api/meta/whatsapp/webhook
  → verifica X-Hub-Signature-256 sobre body crudo
  → valida object='whatsapp_business_account'
  → resuelve tenant por phone_number_id (channel obligatorio)
  → gates: suscripción activa, whatsapp_enabled, cuenta no restringida
  → persiste mensaje/status/evento de forma idempotente
  → actualiza conversations.last_inbound_at si origin='customer'
  → texto: encola la entrega externa (webhook-deliveries)
  → media: attachment_status='pending' + job media_download
  → responde 200 a Meta
  → [cola] baja la media, valida MIME/tamaño, guarda en R2 privado
  → attachment_status='available' | 'failed'
  → [cola] entrega al webhook del tenant
```

Si el medio no puede recuperarse después de los reintentos, el mensaje no desaparece: queda con `attachment_status='failed'` y el webhook externo recibe el evento con ese estado. Los cuatro estados terminales significan cosas distintas y la UI los distingue:

| Estado | Significa | Copy |
|---|---|---|
| `pending` | encolado, todavía no bajó | descargando… |
| `available` | está en R2 | preview / descarga |
| `failed` | lo intentamos y falló definitivamente | no se pudo descargar |
| `deleted` | lo tuvimos y expiró a los 180 días | archivo expirado |
| `unavailable` | Meta nunca lo ofreció (historial > 14 días) | WhatsApp no conserva archivos de más de 14 días |

### D. Mensaje saliente

```text
Sistema externo
  → POST /api/meta/whatsapp/send con API key + Idempotency-Key
  → Resender valida tenant, permiso, cupo, cuota, fuente,
    destinatario y ventana de 24 h (local, sin llamar a Meta)
  → texto:   { "type":"text",  "text":{"body":"..."} }
  → adjunto: { "type":"image", "image":{"link":"https://..."} }
  → POST /{phone_number_id}/messages
  → persiste wamid y respuesta del proveedor
  → statuses posteriores actualizan delivery_status de forma monotónica
```

**Resender no hospeda media saliente.** El cliente entrega una URL pública `https` y Meta la descarga, igual que en Messenger ([Adjunto de salida] en `CONTEXT.md`). Consecuencias que hay que documentar en `/docs`: Meta cachea el archivo 10 minutos, y si el origen del cliente está caído en el instante del envío, el mensaje falla.

## Arquitectura objetivo

**Un solo Worker.** `apps/web` (Next sobre OpenNext) es el producto entero: UI, sesión, API pública, webhooks, persistencia, colas y cron. `apps/api` y `packages/contracts` se borraron (ADR 0012) y no se resucitan para este canal: un tercer canal del mismo producto es precisamente el caso de espejo-a-mano que esa ADR diagnosticó como roto.

Rutas canónicas:

| Ruta | Auth | Para qué |
|---|---|---|
| `GET` y `POST /api/meta/whatsapp/webhook` | HMAC + verify token | Meta |
| `GET /api/meta/whatsapp/start` | sesión | lanza Embedded Signup |
| `POST /api/meta/whatsapp/callback` | sesión + nonce | finaliza Embedded Signup |
| `POST /api/meta/whatsapp/send` | API key + `Idempotency-Key` | salida |
| `GET /api/meta/whatsapp/media/[id]` | API key **o** sesión | descarga de media privada |

El canal usa **rutas propias**, no un campo `channel` en las rutas de Messenger. Es el mismo criterio que Instagram (`CONTEXT.md`, [API externa de salida]).

Módulos:

- `lib/inbound/whatsapp-webhook.ts` — verificación, routing de campos, gates.
- `lib/inbound/whatsapp-parsers/` — parsers puros: `messages[]`, `statuses[]`, `history`, `smb_app_state_sync`, `smb_message_echoes`.
- `lib/outbound/whatsapp-send.ts` — construcción de payload y traducción de errores.
- `lib/meta/whatsapp-client.ts` — cliente Graph tipado.
- `lib/messages/delivery-status.ts` — ranking y monotonía.
- `lib/messages/media-retention.ts` — estado derivado de la edad.
- `lib/pages/page-registry.ts` — `PageChannel` suma `"whatsapp"`.

Toda regla que valga la pena testear vive en un módulo de `lib/`, nunca dentro de un componente: Vitest corre en entorno `node` con `include` `**/*.{test,spec}.ts` y **los `.tsx` no se testean**.

**Presupuesto de bundle.** El techo de Cloudflare es 10 MB gzip; `apps/web/scripts/check-bundle-size.mjs` avisa a 6,5 y falla a 8. El bundle era **5,82 MB** al empezar esta fase. Si el canal lo cruza, el corte correcto es sacar marketing y blog a su propio Worker, no sacar la API de Next (ADR 0012).

## Decisiones de implementación

### Modelo de datos

Crear `apps/web/db/migrations/0017_whatsapp_channel.sql`.

```sql
-- 1. Permiso por cuenta. A diferencia de la 0015, SIN backfill:
--    allí se habilitó a todos porque Instagram ya les funcionaba;
--    acá WhatsApp no le funciona a nadie.
alter table users
  add column whatsapp_enabled boolean not null default false;

-- 2. El canal
alter table connected_pages
  drop constraint connected_pages_channel_check,
  add constraint connected_pages_channel_check
    check (channel in ('messenger', 'instagram', 'whatsapp')),
  add column waba_id text,
  add column whatsapp_phone_e164 text,
  add column onboarding_mode text
    check (onboarding_mode is null
           or onboarding_mode in ('standard', 'coexistence')),
  add column coexistence_status text,
  add column history_sync_status text
    check (history_sync_status is null or history_sync_status in
      ('not_requested','requested','in_progress',
       'complete','failed','expired'));
-- meta_page_id = phone_number_id. El unique (channel, meta_page_id)
-- de la 0013 ya da el ownership por número.
-- token_expires_at se reutiliza.

-- 3. Fuente de la ventana de 24 h.
--    conversations.last_message_at NO sirve: lo bumpea el saliente.
alter table conversations add column last_inbound_at timestamptz;

update conversations c set last_inbound_at = (
  select max(m.created_at) from messages m
  where m.conversation_id = c.id and m.direction = 'inbound');

-- 4. Mensajes
alter table messages
  add column attachment_r2_key text,
  add column attachment_status text
    check (attachment_status is null or attachment_status in
      ('pending','available','failed','deleted','unavailable')),
  add column origin text
    check (origin is null or origin in
      ('customer','resender_api','business_app','history','system')),
  add column historical boolean not null default false,
  add column delivery_status text
    check (delivery_status is null or delivery_status in
      ('accepted','sent','delivered','read','failed','deleted')),
  add column reply_to_meta_message_id text;

-- origin de lo ya persistido: Messenger e Instagram no tienen otra
-- procedencia posible. Sin esto, el filtro origin='customer' de la
-- ventana dejaría mudas todas las conversaciones existentes.
update messages set origin =
  case when direction = 'inbound' then 'customer'
       else 'resender_api' end
where origin is null;

-- 5. Un solo discriminador de contenido: attachment_type, ampliado.
--    Meta modela la ubicación como adjunto en Messenger, así que no
--    es una licencia nuestra. Deuda declarada: "adjunto" pasa a
--    significar "todo lo que no es texto".
alter table messages drop constraint messages_attachment_type_check;
alter table messages add constraint messages_attachment_type_check
  check (attachment_type is null or attachment_type in (
    'image','audio','video','file','sticker','reel','ig_reel',
    'post','ig_post','fallback','appointment_booking','template',
    'unknown',
    'location','contacts','reaction','interactive','order','system'));

-- 6. Dedupe de lo que trae Coexistence. El índice de la 0001 solo
--    cubre direction='inbound'; los echoes y la mitad saliente del
--    historial llegan como outbound con wamid. Índice separado para
--    no cambiar la semántica del insert de Messenger/Instagram.
create unique index if not exists messages_coexistence_meta_id_unique
  on messages(connected_page_id, meta_message_id)
  where meta_message_id is not null
    and direction = 'outbound'
    and origin in ('business_app','history');

create index if not exists messages_attachment_pending_idx
  on messages(attachment_status)
  where attachment_status = 'pending';

-- 7. Borrado de media que sobrevive al cascade de la 0002.
--    Sin FK a users a propósito: es lo único que recuerda qué borrar
--    después de que `delete from users` se lleve todo lo demás.
create table if not exists pending_media_deletions (
  id uuid primary key default gen_random_uuid(),
  r2_prefix text not null unique,
  requested_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text
);
```

Notas de esquema:

- **Un adjunto por mensaje.** Un mensaje de Cloud API tiene exactamente un `type`. Deuda declarada: el día que un canal traiga dos adjuntos hay que migrar a tabla.
- **`text` ya es nullable** desde la `0016`, y `messages_content_present_check` (texto o `attachment_type`) sigue valiendo.
- **El entrante histórico no pisa al vivo.** Si un wamid ya existe como `historical=false`, el `on conflict do update` solo aplica cuando la fila existente ya era histórica.
- La desconexión conserva mensajes y objetos R2. Ver [Borrado de cuenta](#borrado-de-cuenta-y-r2).

### Permiso por cuenta

Copia exacta del patrón de Instagram (ADR 0010), con el catálogo de comportamiento ya definido en `CONTEXT.md` ([Instagram sin permiso]):

- Vive en `lib/auth/channel-access.ts`, se lee vivo contra la base en cada request, nunca del JWT, y es **fail-closed**.
- Apaga el canal entero y en el acto: no se conecta, no se envía, y los entrantes se descartan sin persistir.
- **Connections:** si el tenant no tiene ningún número conectado, el canal no se renderiza. Si lo tiene y le quitaron el permiso, la tarjeta dice **sin acceso**.
- **Inbox:** no cambia; el historial ya recibido se sigue viendo.
- **API:** `403 channel_not_enabled` — el código ya es genérico a propósito, previendo este canal. El `message` sí nombra WhatsApp.
- **Webhook:** `200` a Meta, nada se persiste ni se reenvía, `reason: "channel_not_enabled"` en la bitácora.
- Se opera por SQL: `update users set whatsapp_enabled = true where email = '...'`.

### Cliente WhatsApp

`lib/meta/whatsapp-client.ts`, con operaciones separadas y errores tipados:

- intercambio del code de Embedded Signup;
- validación de WABA/números autorizados;
- registro de número estándar (`/register`) — **solo** en el flujo A;
- suscripción/desuscripción de WABA;
- **solicitud de history sync** (SMB App Data API, `sync_type='history'`);
- consulta y descarga de media entrante;
- envío de payloads de texto y media por `link`;
- traducción de error 190, permisos, rate limits y ventana cerrada.

`META_GRAPH_VERSION` centralizada y validada al arrancar. No se hardcodea la versión en cada llamada; hoy `lib/outbound/meta-send.ts` la tiene inline y ese es el patrón que no se repite.

**Catálogo de traducción propio.** Son cuatro, no uno: Messenger, DM de Instagram, comentario de Instagram y WhatsApp. Los tres motivos que no dependen de qué se enviaba —token vencido, rate limit, bloqueo por política— se comparten.

### Embedded Signup y seguridad

En `apps/web`:

- Botón separado para número nuevo y número existente, con copy distinto.
- Facebook JS SDK cargado una sola vez.
- Nonce y correlación de sesión generados server-side.
- `response_type: 'code'`, `override_default_response_type: true`, `sessionInfoVersion` vigente.
- **Session logging habilitado**: es requisito de Meta para Coexistence, no una opción.
- Para Coexistence, el feature type oficial de Business App onboarding vigente al implementar.
- Validación estricta de `event.origin`, tipo de evento, nonce y shape; no confiar solo en `postMessage`.
- Al servidor van únicamente code e identificadores. **Nunca** tokens en browser o local storage.
- Registrar el paso exacto de fallo (`exchange`, `assets`, `register`, `subscribe`, `sync_request`, `persist`) sin exponer secretos.
- No hay pantalla de [Selección de páginas]: Embedded Signup autoriza assets concretos, así que el callback persiste directo, igual que Instagram.
- **Validar cupo de plan antes del intercambio del code**, porque el code se quema al usarlo una vez.

### Webhook y Coexistence

Parsers puros en `lib/inbound/whatsapp-parsers/`:

- `messages[]` y `statuses[]` estándar;
- `history` (chunks fuera de orden, `chunk_order`, fases, `progress`);
- `smb_app_state_sync`;
- `smb_message_echoes`;
- eventos de cuenta/calidad para detectar offboarding o conexión degradada.

El webhook:

- verifica HMAC con `META_APP_SECRET` sobre el body crudo, y usa `WHATSAPP_VERIFY_TOKEN` propio para el challenge;
- limita el tamaño del body antes de parsear;
- responde `200` después de persistir y encolar — **no** después de descargar archivos ni de llamar al webhook del tenant;
- ignora con métrica los WABA/números no conectados;
- conserva los tipos desconocidos como `attachment_type='unknown'` con el nombre real en `attachment_meta.rawType`; nunca los convierte en texto falso;
- actualiza `delivery_status` de forma monotónica.

**Monotonía (`lib/messages/delivery-status.ts`).** `failed` no es el escalón siguiente a `read`: es una rama terminal alternativa. Un mensaje leído no puede fallar después.

```ts
const RANK = { accepted: 1, sent: 2, delivered: 3, read: 4, deleted: 5 }

export function outranks(next, prev) {
  if (prev === null) return true
  if (next === 'deleted') return true          // borrar para todos es real siempre
  if (next === 'failed')
    return prev !== 'delivered' && prev !== 'read' && prev !== 'deleted'
  if (prev === 'failed') return false
  return RANK[next] > RANK[prev]
}
```

Un callback que no supera el rango se ignora y se registra con métrica: es una incoherencia de Meta, no un dato que valga la pena mostrar.

El `UPDATE` es único y no lee antes, para que no haya carrera:

```sql
update messages set delivery_status = $1
where connected_page_id = $2 and meta_message_id = $3
  and (delivery_status is null or <outranks>);
```

### Ventana de 24 horas

`conversations.last_inbound_at`, escrita en **un solo lugar** (`lib/messages/message-log.ts`) y solo cuando `direction='inbound' and historical=false and origin='customer'`, con semántica `greatest(...)`.

```ts
if (!lastInboundAt || now - lastInboundAt >= 24h)
  return 409 customer_service_window_closed
         { requiresTemplate: true, templateSendingSupported: false }
  // sin llamar a Meta
```

Se eligió estado materializado sobre consulta en vivo porque el Inbox necesita el estado de ventana **por conversación en una lista**: con una consulta por envío, pintar 50 conversaciones serían 50 lateral joins. Deuda declarada: es estado derivado, y por eso la escritura vive en un solo módulo y no en cada parser.

### Multimedia y Cloudflare R2

Bucket R2 **privado** por ambiente, binding `WHATSAPP_MEDIA` en `apps/web/wrangler.jsonc`. **R2 se usa solo para media entrante.**

Reglas:

- Keys con prefijo no adivinable, con el tenant primero: `wa/{tenantId}/{messageId}/{random}`. Nunca el filename como path.
- Metadata y ownership en Postgres. R2 tiene bytes; **no es la fuente de autorización**.
- Validar tipo declarado, MIME real, tamaño y filename sanitizado contra la tabla de [Hechos de plataforma verificados](#media), centralizada y cubierta por tests.
- Descargar la media entrante inmediatamente: la URL de Meta dura 5 minutos y no se persiste nunca.
- El bucket no tiene acceso público ni `r2.dev` habilitado.
- No cargar archivos completos en memoria: se hace streaming desde R2 al cliente.
- Los retries son idempotentes: un mismo job no crea dos objetos ni dos pushes.

**Retención: 180 días para todos los planes.** Una lifecycle rule por bucket, cero código de borrado, y el estado se deriva de la edad para que no pueda desincronizarse:

```ts
export const MEDIA_RETENTION_DAYS = 180

export function effectiveStatus(row, now) {
  if (row.attachment_status !== 'available') return row.attachment_status
  return ageInDays(row.created_at, now) > MEDIA_RETENTION_DAYS
    ? 'deleted' : 'available'
}
```

Sin esto el costo no está acotado por nada: la cuota mide eventos, no bytes. Un Starter de $15/mes recibiendo documentos de 100 MB acumula cientos de GB en un mes, y crece aunque el tenant deje de usar el producto. 180 días es un número elegido, no derivado: queda escrito en `/terms` y en la UI.

**Descarga: una ruta, dos autenticaciones.** `GET /api/meta/whatsapp/media/[id]` acepta `Authorization: Bearer <api key>` (el push) o la cookie de sesión (el Inbox). No se usan URLs prefirmadas: el binding de R2 no las firma —requeriría habilitar la API S3, dos secretos nuevos y una librería de firma en el bundle— y una URL filtrada es acceso anónimo al archivo.

```ts
const tenantId = await tenantFromApiKey(req) ?? await tenantFromSession()
if (!tenantId) return 401

// ownership en Postgres, no en R2
const row = await sql`select attachment_r2_key, attachment_status, attachment_meta
                      from messages where id = ${id} and tenant_id = ${tenantId}`
if (!row) return 404   // 404 y no 403: no revela la existencia del objeto
if (effectiveStatus(row, now) !== 'available') return 409 { status }

const range = req.headers.get('range')
const obj = await env.WHATSAPP_MEDIA.get(row.attachment_r2_key,
                                         range ? { range } : undefined)
return new Response(obj.body, {
  status: range ? 206 : 200,
  headers: { 'content-type': mime, 'accept-ranges': 'bytes' },
})
```

**Range es obligatorio**, no un extra: sin él, un `<audio>` de nota de voz no se puede adelantar en el navegador.

### Trabajo asíncrono

Cola propia `whatsapp-jobs` con DLQ, separada de `webhook-deliveries`. La separación no es estética: un import de historial son miles de jobs, y en la cola de entregas competirían en batches de 10 con los pushes de **todos** los tenants.

| Job | Qué hace | Si falla |
|---|---|---|
| `history_sync_request` | llama a la SMB App Data API | reintenta; agotado → `history_sync_status='failed'`, visible en Connections |
| `history_chunk` | persiste un chunk del historial | reintenta; DLQ |
| `media_download` | baja media de Meta a R2 | reintenta; agotado → `attachment_status='failed'` |
| `media_purge` | borra el prefijo R2 de una cuenta eliminada | reintenta; el cron lo reclama |

El cron existente de 5 minutos se reutiliza para reclamar jobs vencidos, incluido el sync no confirmado antes de las 24 h.

### Borrado de cuenta y R2

El borrado hoy es `delete from users where id = $tenantId` con FKs `on delete cascade` (`0002`), «inmediato y transaccional». El problema al agregar bytes: **en el instante de ese DELETE no queda ninguna fila que recuerde qué hay en R2**, y R2 no tiene «borrar por prefijo» —hay que listar y borrar de a 1000, decenas de round trips que no caben en un request.

```ts
// antes del DELETE, en una tabla SIN foreign key a users
insert into pending_media_deletions (r2_prefix)
  values ('wa/' || tenantId || '/') on conflict do nothing;

await sql`delete from users where id = ${tenantId}`
await env.WHATSAPP_JOBS.send({ type: 'media_purge', prefix })
```

El job es reanudable con cursor y solo borra la fila de `pending_media_deletions` cuando R2 confirma. La lifecycle rule de 180 días queda como **red de seguridad**: aunque el job muera para siempre, los bytes expiran solos y el peor caso está acotado.

Consecuencia que hay que declarar en `/privacy`, no esconder: al eliminar la cuenta se conserva un identificador interno hasta confirmar el borrado de los archivos, y nunca más de 180 días.

### Cuota y facturación

Un número de WhatsApp es una [Conexión] y ocupa un slot del plan, sin agrupar por negocio (ADR 0011). El [Gate de suscripcion] y [Cuenta restringida] aplican igual que en los otros canales.

[Mensaje contabilizado] suma:

| Evento | ¿Cuota? |
|---|---|
| Entrante vivo del cliente, persistido | **sí** |
| Envío por API que Meta acepta | **sí** |
| Echo de Business App persistido | **sí** — es tráfico vivo y se reenvía al webhook |
| Mensaje importado por history sync (`historical=true`) | **no** |
| Envío que Meta rechaza | no |
| Replay idempotente | no |

La excepción del historial es única y declarada: es un backfill de conversaciones que ocurrieron **fuera** de Resender y que además no se reenvían al webhook del tenant. Cobrar por algo que decidimos no entregar no se puede defender, y sin la excepción un Starter podría quedar sin cuota el mismo día que conecta.

### Entrega al webhook externo

Se conserva el sobre existente `{type, tenant, page, conversation, message}` y la **forma singular** de `message.attachment` que ya consumen los clientes de Messenger. No se bifurca el payload por canal: una forma uniforme se consume más fácil que una que cambia según el canal.

```json
{
  "type": "message",
  "tenant": { "id": "uuid" },
  "page": {
    "id": "uuid",
    "channel": "whatsapp",
    "username": null,
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
    "historical": false,
    "text": "Factura",
    "attachment": {
      "type": "document",
      "url": "https://resender.dev/api/meta/whatsapp/media/uuid",
      "title": "factura.pdf",
      "details": {
        "mimeType": "application/pdf",
        "sizeBytes": 12345,
        "status": "available"
      }
    },
    "replyToProviderMessageId": null,
    "deliveryStatus": null,
    "createdAt": "2026-08-24T12:00:00Z"
  }
}
```

- Los campos nuevos son **aditivos**: no rompen a los consumidores existentes.
- `attachment.url` requiere la misma API key del tenant. No es una firma pública permanente.
- Cuando `details.status` es `unavailable` o `deleted`, `url` va `null` y el cliente sabe que no debe reintentar.
- Los mensajes con `historical: true` **nunca** se envían al webhook.
- Cada POST va firmado con `resender-event-id`, `resender-timestamp` y `resender-signature`, igual que los demás canales ([Firma del push]).

No se exponen tokens de Meta, credenciales R2, URLs temporales de Meta ni payloads crudos.

### API pública de salida

`POST /api/meta/whatsapp/send`, con API key e `Idempotency-Key` obligatoria. **El body es el mismo de Messenger.**

```json
{ "pageId": "uuid", "recipientId": "5215555555555", "reply": "Hola" }
```

```json
{
  "pageId": "uuid",
  "recipientId": "5215555555555",
  "attachment": { "type": "image", "url": "https://cdn.cliente.mx/f.jpg" }
}
```

Exactamente uno de `reply` o `attachment`, como en Messenger. `conversationId` es opcional y, si viene, debe coincidir.

Validaciones, en este orden:

1. API key válida y tenant resuelto.
2. `whatsapp_enabled` → si no, `403 channel_not_enabled`.
3. Suscripción activa y cuenta no restringida; cuota disponible.
4. `pageId` pertenece al tenant, es canal `whatsapp` y está `active`.
5. `recipientId`, `conversationId` y contacto coinciden.
6. **Ventana abierta** según `last_inbound_at` → si no, `409 customer_service_window_closed`, **sin llamar a Meta**.
7. Tipo de adjunto válido y URL `https`.

Los envíos se persisten en éxito y en fallo. Un error de Meta se persiste y se traduce sin esconder el payload seguro de diagnóstico.

### Estados y UI

**Connections** muestra: badge WhatsApp, número visible y WABA ID secundario, modo estándar o Coexistence, estado de token y suscripción, **estado del history sync** (`requested / in_progress / complete / failed / expired`, con acción concreta en los dos últimos), editor de webhook URL, reconectar/desconectar, y la explicación de las limitaciones de Coexistence — incluido el techo de 20 mps y que la elegibilidad la decide Meta.

**Inbox** muestra: texto y caption; thumbnails y reproductores para imagen, audio y video; filename, tamaño y descarga para documentos; ubicación, contacto, reacción y contexto de reply; los cinco estados de adjunto con su copy propio; el origen (API o Business App); y `sent/delivered/read/failed` **sin confundirlos con el estado interno**. Una `reaction` no se pinta como burbuja propia: se muestra sobre el mensaje al que apunta (`reply_to_meta_message_id`).

## Requisitos de Meta y preparación de Tech Provider

Trabajo administrativo en paralelo desde el inicio:

1. Business Portfolio de Lorna Suriano Hernandez con 2FA y Business Verification.
2. Dominio `resender.dev` y correo corporativo verificables.
3. Meta App tipo Business propiedad del portfolio; producto WhatsApp agregado.
4. WABA y **dos números propios**: uno se quema en `/register` para el flujo estándar y ya no sirve para Coexistence.
5. Un teléfono con **WhatsApp Business App ≥ 2.24.17** para el número de Coexistence.
6. Embedded Signup configurado para estándar y Coexistence, **con session logging**.
7. Webhook público HTTPS y suscripción por WABA a `messages`, `history`, `smb_app_state_sync` y `smb_message_echoes`.
8. Advanced Access para los permisos que el dashboard exija: `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`.
9. App Review con cuenta revisora, instrucciones y screencasts.
10. Access Verification como Tech Provider.
11. App en Live antes de onboarding de negocios externos.
12. **Verificar la elegibilidad de Coexistence para el código de país del número de prueba** antes de comprometer fecha.

Business Verification, App Review, Access Verification y App Live son gates distintos. La fase de ingeniería puede terminar con la solicitud enviada; el rollout público sigue bloqueado hasta recibir aprobación, y además detrás de `whatsapp_enabled`.

## Cumplimiento

Actualizar antes de App Review:

- `/privacy`: WhatsApp, WABA, números, perfiles, contenido, multimedia, Coexistence, R2, Cloudflare/Neon, **retención de 180 días** y **el identificador que sobrevive al borrado hasta confirmar la purga de R2**. Eliminar referencias obsoletas a un producto solo Messenger o a hosting en Vercel.
- `/terms`: opt-in, ventana de 24 h, prohibición de spam, responsabilidad por automatizaciones y contenido multimedia, **retención de 180 días de los archivos**, y que **la media saliente la hospeda el cliente**.
- `/data-deletion` y eliminación de cuenta: WABA, tokens, mensajes y objetos R2.
- Footer: contacto legal y de seguridad.
- Dashboard Meta: icono, categoría, email, URLs públicas y método de eliminación.
- Cuenta revisora con suscripción y entitlements necesarios, `whatsapp_enabled = true`, y datos no sensibles.

La automatización demo responde solo cuando el revisor inicia la conversación; no depende de plantillas.

## Estrategia de pruebas

### Unitarias

- Parsers de cada tipo de mensaje y status.
- Parsers `history` (chunks fuera de orden, fases, `progress`), `smb_app_state_sync` y `smb_message_echoes`.
- Tipos desconocidos se conservan como `unknown` con `rawType` y nunca rompen el lote.
- Nonce, `event.origin` y shape de Embedded Signup.
- Diferencia entre registro estándar y Coexistence: el flujo B **no** llama a `/register`.
- Ventana: abierta, borde exacto de 24 h, cerrada; que un histórico no la abre; que un echo de `business_app` no la abre.
- `outranks`: los seis casos de borde, incluido `failed` después de `read` y `deleted` después de todo.
- Catálogo de MIME y tamaños, y filename sanitizado.
- `effectiveStatus` de retención en el borde de 180 días.
- Cuota: el historical no suma, el echo sí, el rechazado no.
- Ownership de número, media y conversación.

### Integración local/Worker

- Migración `0017` sobre fixture con Messenger e Instagram existentes, incluido el backfill de `origin` y `last_inbound_at`.
- Callback estándar y Coexistence.
- Challenge y firma válida/inválida del webhook.
- Persistencia y encolado **antes** del `200`.
- Media pendiente → R2 disponible → webhook externo.
- Media del historial sin asset id → `unavailable`, sin job encolado.
- Retry y DLQ de descarga y de entrega externa sin duplicados.
- Dedupe: reentrega del mismo chunk de historial no duplica filas; un echo repetido tampoco.
- El histórico no pisa al vivo cuando comparten wamid.
- `history_sync_request` que falla deja `history_sync_status='failed'` visible.
- Descarga de media con API key, con sesión, con Range, y cross-tenant denegada (`404`).
- Envío fuera de ventana: `409` **sin llamada a Meta** (verificado con el cliente mockeado).
- Account deletion inserta en `pending_media_deletions`, borra la base y el job purga R2; si R2 falla, la fila queda.
- Compatibilidad: el payload de Messenger no cambia.

### End-to-end real

Con assets propios de Meta:

1. Conectar número estándar, mandar texto y media al número, y responder dentro de 24 h.
2. Conectar un **segundo** número por Coexistence desde WhatsApp Business App.
3. Confirmar que el `history_sync_request` sale y que llegan chunks (o cero, si el negocio no compartió).
4. Confirmar sync de contactos e historial **sin** pushes históricos y **sin** consumo de cuota.
5. Confirmar que la media del historial de más de 14 días queda `unavailable`.
6. Enviar desde Business App y confirmar echo en Resender y en el webhook externo.
7. Enviar desde la API y verificar aparición y entrega.
8. Probar imagen, audio/voz, video, documento y sticker en ambos sentidos.
9. Confirmar `sent/delivered/read/failed` por `wamid`, y que un callback atrasado no retrocede.
10. Intentar envío fuera de ventana y obtener `409` sin llamada a Meta.
11. Desconectar y reconectar, comprobando que no se pierde historial ni media.
12. Borrar una cuenta de prueba y verificar que el prefijo R2 queda vacío.

## Criterios de aceptación de Fase 1

- [ ] `whatsapp` existe en BD, API, docs públicas y UI sin regresiones en Messenger/Instagram.
- [ ] El canal está apagado por defecto y `whatsapp_enabled` lo gobierna en las cinco superficies.
- [ ] Onboarding estándar conecta un número propio de extremo a extremo.
- [ ] Coexistence conecta un número elegible, pide el sync dentro de las 24 h y procesa chunks y echoes.
- [ ] Texto y multimedia funcionan en entrada, almacenamiento, webhook externo, UI y salida.
- [ ] Ningún mensaje desconocido se pierde silenciosamente.
- [ ] Media es privada, tenant-scoped, servida con Range, verificable y eliminable.
- [ ] Los cinco estados de adjunto se distinguen en el dato y en la UI.
- [ ] Webhook responde rápido y el trabajo lento es durable en `whatsapp-jobs`.
- [ ] Idempotencia impide duplicar provider calls, mensajes, objetos y pushes, incluidos chunks reentregados.
- [ ] Ventana de 24 horas se aplica localmente; plantillas no están implementadas.
- [ ] Estados de entrega se reflejan de forma monotónica y `failed` no pisa a `read`.
- [ ] El historial no consume cuota; los echoes sí.
- [ ] Desconexión conserva historial; eliminación de cuenta deja el prefijo R2 vacío o un job recuperable visible.
- [ ] Privacidad, términos y eliminación describen el comportamiento real, incluida la retención de 180 días.
- [ ] Existe cuenta demo, automatización, instrucciones y screencasts de revisión.
- [ ] Lint, typecheck, tests y build pasan, y el bundle sigue por debajo de 6,5 MB gzip (o se documenta el plan de corte).
- [ ] Pruebas reales estándar y Coexistence quedan documentadas con evidencia; si el número resulta inelegible, se declara explícitamente qué quedó sin evidencia end-to-end.

## Gates de lanzamiento

### Ingeniería completa

- Todos los criterios anteriores pasan con assets propios y de prueba.
- Solicitud de permisos y paquete de revisión listos o enviados.

### Producción multi-tenant

- Business Verification aprobada.
- Advanced Access aprobado.
- Access Verification como Tech Provider aprobada cuando Meta la exija.
- Meta App en Live.
- Smoke test con un negocio externo controlado, habilitado por SQL uno a uno.
- Runbook de revocación, offboarding, fallos de media, deadline de sync vencido y DLQ.

## Riesgos principales

- **Aprobación externa:** Meta puede cambiar nombres, pantallas y requisitos; registrar evidencia y fecha de cada configuración.
- **Elegibilidad de Coexistence:** país, número, cuenta, versión o dispositivo pueden ser inelegibles, y Meta no publica lista consolidada. Mostrar error accionable y ofrecer onboarding estándar, sin prometer migración automática. **Es el único criterio de aceptación cuya evidencia depende de una decisión de Meta.**
- **Deadline de 24 h del sync:** si el `history_sync_request` falla en silencio, la conexión muere sin que nadie se entere. Por eso el estado es visible en Connections y el cron lo reclama.
- **Eventos voluminosos:** history y media nunca dentro del webhook; siempre por `whatsapp-jobs`.
- **Media temporal de Meta:** la URL dura 5 minutos y el media ID 7 días. R2 es la única copia.
- **Media saliente hospedada por el cliente:** un origen caído en el instante del envío falla el mensaje, y Meta cachea solo 10 minutos.
- **Privacidad y costo de R2:** ownership, borrado y retención de 180 días son criterio de aceptación, no optimización.
- **Techo de 20 mps en Coexistence:** un número en Coexistence no escala por messaging tier. Documentarlo antes de venderlo.
- **Sin plantillas:** el producto no puede iniciar ni reabrir conversaciones; UI, API y marketing deben decirlo claramente.
- **Bundle:** el canal entero entra en el Worker que ya mide 5,82 de 8 MB. Si lo cruza, el corte es marketing y blog.
- **Políticas de automatización:** Resender es infraestructura para casos de negocio; los términos deben prohibir spam y usos incompatibles con las políticas vigentes de WhatsApp.

## Deuda declarada

Elegida a sabiendas, no descubierta. Va completa en la ADR de esta fase.

1. **Elegibilidad de Coexistence fuera de nuestro control.** Si el número resulta inelegible, ese criterio de aceptación se entrega sin evidencia end-to-end y se declara.
2. **Cardinalidad 1 en el esquema de adjuntos.** El día que un canal traiga dos, hay que migrar a tabla.
3. **«Adjunto» pasa a significar «todo lo que no es texto».** La entrada [Adjunto] de `CONTEXT.md` dice «archivo o tarjeta» y hay que corregirla.
4. **Media saliente por `link`:** Meta cachea 10 minutos y el cliente hospeda el archivo.
5. **`last_inbound_at` es estado derivado.** Un parser nuevo que olvide escribirlo deja la conversación muda; por eso la escritura vive en un solo módulo.
6. **Dos índices únicos parciales parecidos** sobre las mismas dos columnas. Hay que leer los dos para entender la regla completa.
7. **180 días es un número elegido**, no derivado de una medición.
8. **El uuid del tenant sobrevive al borrado** hasta que R2 confirma. Declarado en `/privacy`.
9. **El backfill de la `0015` deja de ser regla general.** Se hizo porque Instagram ya funcionaba para esas cuentas; la `0017` no lo hace porque WhatsApp no funcionaba para nadie.
10. **Cinco estados de adjunto.** La UI tiene cinco ramas.
11. **El día del Advanced Access hay que correr un `update` a mano.** No hay pantalla que lo recuerde.

## Variables, bindings e infraestructura

Todo en `apps/web`. No hay un segundo Worker.

### Secretos y vars

- `META_APP_ID` — reuso.
- `META_APP_SECRET` — reuso, para firma del webhook e intercambio del code.
- `WHATSAPP_VERIFY_TOKEN` — **nuevo**, propio del challenge de este webhook.
- `META_GRAPH_VERSION` — **nuevo**, versión centralizada y validada al arrancar.
- `TOKEN_ENCRYPTION_KEY` — reuso.
- `DATABASE_URL` — reuso.
- `NEXT_PUBLIC_META_APP_ID` — reuso.
- `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` — **nuevo**, Configuration ID de Embedded Signup.

No se guardan PIN, App Secret, system-user token ni credenciales R2 en variables públicas ni en el repositorio.

### Bindings

- `WHATSAPP_MEDIA` — bucket R2 privado, uno por ambiente.
- `WHATSAPP_JOBS` — productor de la cola `whatsapp-jobs`.
- Consumidores de `whatsapp-jobs` y `whatsapp-jobs-dlq`.
- `WEBHOOK_DELIVERIES` — reuso, sin cambios.
- Cron `*/5 * * * *` — reuso; suma el reclamo de `history_sync_request` no confirmado.

### Infraestructura manual

Se crea a mano y se documenta en `docs/api-cloudflare-manual-runbook.md`:

```bash
npx wrangler r2 bucket create whatsapp-media
npx wrangler r2 bucket create whatsapp-media-staging
npx wrangler r2 bucket lifecycle add whatsapp-media \
  --prefix wa/ --expire-days 180
npx wrangler r2 bucket lifecycle add whatsapp-media-staging \
  --prefix wa/ --expire-days 180

npx wrangler queues create whatsapp-jobs
npx wrangler queues create whatsapp-jobs-dlq
npx wrangler queues create whatsapp-jobs-staging
npx wrangler queues create whatsapp-jobs-staging-dlq
```

Los buckets y colas de staging son propios: compartirlos con producción haría que un job de prueba tocara los archivos de un cliente que paga.

## Referencias vigentes

- Meta — Onboarding de Business App users (Coexistence): https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- Meta — Media (tipos, tamaños y plazos): https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
- Meta — WhatsApp Business Platform: https://www.postman.com/meta/whatsapp-business-platform/overview
- Meta — Embedded Signup: https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Meta — Cloud API Messages: https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages
- Meta — Webhook Messages Object: https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object
- Meta — Statuses Object: https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object
- Meta — Tech Providers: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Cloudflare — R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Cloudflare — R2 lifecycle rules: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Repo — ADR 0012 (un solo Worker): `docs/adr/0012-un-solo-worker-next-sin-api-separada.md`
- Repo — ADR 0011 (cupo por conexión): `docs/adr/0011-cupo-por-conexion-e-instagram-en-facturacion.md`
- Repo — ADR 0010 (permiso por cuenta): `docs/adr/0010-permiso-de-instagram-por-cuenta.md`
- Repo — Glosario: `CONTEXT.md`
