# Fase 1 — API migration

## Estado del documento

- **Objetivo:** construir el backend separado sin cambiar el comportamiento del frontend actual.
- **Resultado desplegable:** un nuevo Worker `api` basado en Hono, con API pública, RPC interno, consumo de Queues, OpenAPI y observabilidad propios.
- **Condición de seguridad:** durante esta fase no se cambian las URLs productivas de Meta o Stripe y `apps/web` sigue atendiendo el producto actual.
- **Siguiente fase:** [Fase 2 — API migration/frontend](./phase-2-api-migration-frontend.md).
- **Decisión anulada:** no usar como autoridad el ADR de ownership/separación que se eliminó. Este documento contiene la arquitectura vigente.

## Resumen ejecutivo

El monorepo terminará teniendo dos Workers:

```text
Internet / Developers
          |
          v
 api.resender.dev  ---> Worker api (Hono)
                           |-- HTTP público /v1
                           |-- callbacks /webhooks/meta y /webhooks/stripe
                           |-- RPC WebAppApi (solo Service Binding)
                           |-- producer/consumer de Queues
                           `-- PostgreSQL + proveedores externos

Navegador ---> resender.dev ---> Worker web (Next/OpenNext)
                                      |
                                      `-- en fase 2: Service Binding RPC ---> api
```

En fase 1 se crea y valida toda la columna de `api`, pero el Worker `web` continúa leyendo PostgreSQL y ejecutando sus handlers actuales. Esa duplicidad es temporal y deliberada; se elimina por completo en fase 2.

El Worker `api` será **un solo código y un solo despliegue**, con tres puertas de entrada:

1. `fetch`: Hono y sus endpoints HTTP públicos.
2. `WebAppApi`: `WorkerEntrypoint` nombrado para RPC interno desde `web`.
3. `queue`: consumidor de entregas a los webhooks de los clientes y de su DLQ.

No se crearán rutas HTTP `/internal` protegidas con un header secreto. Los flujos público e interno llaman a los mismos casos de uso; solo cambia cómo se resuelve el actor:

- API pública: el tenant se obtiene de la API key.
- RPC: el tenant/usuario se recibe de la sesión autenticada de Next y el backend vuelve a validar ownership.

En este plan, “RPC” significa **Cloudflare Workers RPC mediante Service Binding**. No significa el RPC/client `hc` de Hono. Hono se usa para la superficie HTTP; el entrypoint interno es una capacidad de Cloudflare y no tiene URL pública.

## Contexto actual que el agente debe conservar

El repositorio es un Turborepo con workspaces npm:

- `apps/web`: Next.js 16.2.11, OpenNext para Cloudflare y Wrangler.
- `packages/ui`, `packages/eslint-config`, `packages/typescript-config`.
- PostgreSQL en Neon mediante `@neondatabase/serverless`.
- El Worker `web` actual se configura en `apps/web/wrangler.jsonc`.
- `apps/web/next.config.ts` ya inicializa `initOpenNextCloudflareForDev()`.
- NextAuth usa sesiones JWT.
- Las migraciones vigentes están en `apps/web/db/migrations/0001...0009`.

Handlers que hoy viven en Next:

- `/api/auth/[...nextauth]`
- `/api/meta/start`
- `/api/meta/callback`
- `/api/meta/send`
- `/api/meta/webhook`
- `/api/stripe/webhook`

Reglas que no se deben perder al portar los casos de uso:

- Autenticación de API key y aislamiento por tenant.
- Waitlist, suscripción activa, entitlement y cuota por periodo.
- Resolución segura de Page tokens y validación de ownership.
- Idempotencia del envío.
- Validación de que `conversationId`, Page y contacto coincidan.
- Persistencia de mensajes salientes exitosos y fallidos.
- Marcado de Page token inválido.
- Incremento de uso únicamente cuando Meta acepta el mensaje.
- Verificación HMAC del webhook de Meta.
- Deduplicación de mensajes entrantes por ID de Meta.
- Registro de cada intento de entrega al webhook del cliente.
- Orden y deduplicación de eventos de Stripe.

Antes de editar código de Next en la fase 2, el agente debe leer la guía relevante de esta versión en `node_modules/next/dist/docs/`, tal como exige `AGENTS.md`.

## Alcance

### Incluido

- Crear `apps/api` como Worker Cloudflare con Hono.
- Crear `packages/contracts` para DTOs, esquemas Zod, errores y contrato RPC compartido.
- Implementar la API pública v1 descrita en este documento.
- Exponer OpenAPI como JSON, descarga y Swagger UI.
- Implementar el `WorkerEntrypoint` nombrado `WebAppApi`.
- Portar lógica de dominio y acceso a datos al nuevo backend sin importarla desde `apps/web`.
- Implementar el nuevo callback de Meta y la entrega asíncrona al webhook del cliente con Cloudflare Queues.
- Implementar el callback de Stripe en el nuevo Worker, sin cambiar aún Stripe en producción.
- Pruebas unitarias, de contrato y de runtime Worker.
- Desarrollo local con `npm run dev`.
- Entorno staging y observabilidad separada.

### Fuera de alcance

- Cambiar las lecturas, Server Actions o handlers que usa el frontend productivo.
- Agregar el Service Binding a `web`; ocurre en fase 2.
- Cambiar las URLs productivas configuradas en Meta o Stripe.
- Eliminar acceso a base de datos o secretos de `web`.
- Migrar de Neon HTTP a Hyperdrive en el mismo cambio. Hyperdrive queda como hardening posterior para no mezclar dos migraciones de infraestructura.
- Crear un Worker adicional para las Queues.
- Agregar un segundo Queue antes de persistir los eventos de Meta.
- Crear un recurso `contacts` independiente. En v1 el contacto es parte de una conversación porque el modelo actual no tiene tabla de contactos y el PSID está scoped por Page.
- Exponer gestión de usuarios, billing o API keys mediante API key pública.

## Estructura objetivo

```text
apps/
  api/
    src/
      index.ts                         # default fetch + queue + scheduled
      app.ts                           # OpenAPIHono
      entrypoints/
        web-app-api.ts                 # class WebAppApi extends WorkerEntrypoint
      routes/
        health.ts
        docs.ts
        v1/
          me.ts
          pages.ts
          conversations.ts
          messages.ts
        webhooks/
          meta.ts
          stripe.ts
      middleware/
        api-key-auth.ts
        request-context.ts
        error-handler.ts
        body-limit.ts
      application/
        auth/
        account/
        api-keys/
        billing/
        conversations/
        messages/
        pages/
        provider-webhooks/
        webhook-deliveries/
      domain/
      infrastructure/
        db/
        meta/
        stripe/
        posthog/
        queues/
        crypto/
      observability/
      test/
    package.json
    tsconfig.json
    vitest.config.ts
    wrangler.jsonc
    .dev.vars.example
packages/
  contracts/
    src/
      http/
      rpc/
      schemas/
      errors.ts
      index.ts
    package.json
    tsconfig.json
```

Reglas de dependencias:

- `apps/api` puede depender de `packages/contracts`.
- `apps/web` dependerá de `packages/contracts` en fase 2.
- `packages/contracts` no importa Hono, Next, SQL ni SDKs de Meta/Stripe.
- `apps/api` no importa ningún archivo de `apps/web`.
- Los repositorios SQL y respuestas crudas de proveedores nunca se comparten con `web`.

## Diseño de la API v1 para confirmación

Las siguientes decisiones se consideran el contrato propuesto. Si Arturo pide un cambio, debe actualizarse primero esta sección, los esquemas de `packages/contracts` y el snapshot OpenAPI.

### Convenciones

- Base productiva: `https://api.resender.dev`.
- Versión en URL: `/v1`.
- JSON en `camelCase`; fechas ISO-8601 UTC; IDs como strings.
- Content type: `application/json`.
- Autenticación: `Authorization: Bearer <api-key>`.
- Se mantienen compatibles las API keys existentes con prefijo `pk_live_`.
- Las API keys de fase 1 tienen acceso completo al tenant. Scopes y ambientes test/live se difieren para no ampliar esta migración.
- La API es server-to-server. No se habilita CORS global con `*`.
- Límite por defecto: 25; máximo: 100.
- Paginación opaca por cursor, nunca por offset.
- Orden de listas: más reciente primero, salvo que un endpoint indique lo contrario.
- Cada respuesta incluye `X-Request-Id`; el cliente puede enviar uno válido o el backend genera un UUID.
- Los límites de plan son distintos del rate limit técnico. Ambos se aplican.
- Nunca se devuelven Page tokens, hashes, secretos, payloads crudos de Stripe/Meta ni `provider_response`.

### Autenticación y errores

Respuesta de error uniforme:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is invalid.",
    "requestId": "2af3b790-2cf7-4d1d-b902-e635a7ab6b34",
    "details": [
      {
        "path": "text",
        "message": "Required"
      }
    ]
  }
}
```

Códigos base:

| HTTP | `error.code`                                                     | Uso                                     |
| ---- | ---------------------------------------------------------------- | --------------------------------------- |
| 400  | `invalid_json`, `validation_error`                               | JSON o parámetros inválidos             |
| 401  | `missing_api_key`, `invalid_api_key`                             | autenticación                           |
| 402  | `quota_exceeded`                                                 | cuota de mensajes agotada               |
| 403  | `account_waitlisted`, `subscription_required`, `plan_restricted` | entitlement                             |
| 404  | `not_found`                                                      | el recurso no existe dentro del tenant  |
| 409  | `idempotency_conflict`                                           | misma key con payload diferente         |
| 422  | `provider_rejected`                                              | Meta rechazó una solicitud válida       |
| 429  | `rate_limited`                                                   | límite técnico; incluye `Retry-After`   |
| 502  | `provider_unavailable`                                           | error transitorio de Meta               |
| 500  | `internal_error`                                                 | error no esperado sin detalles internos |

Una búsqueda por ID fuera del tenant responde `404`, no `403`, para no filtrar existencia.

### Envelope de éxito y paginación

Recurso individual:

```json
{
  "data": {
    "id": "..."
  }
}
```

Lista:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": "opaque-or-null",
    "hasMore": false
  }
}
```

### Endpoints de plataforma y documentación

| Método | Ruta                | Auth | Descripción                                                                     |
| ------ | ------------------- | ---: | ------------------------------------------------------------------------------- |
| GET    | `/healthz`          |   No | Liveness del proceso; no consulta DB                                            |
| GET    | `/readyz`           |   No | Comprueba dependencias mínimas y responde `200` o `503`, sin detalles sensibles |
| GET    | `/docs`             |   No | Swagger UI interactivo                                                          |
| GET    | `/openapi.json`     |   No | OpenAPI JSON inline y consumible por herramientas                               |
| GET    | `/openapi/download` |   No | El mismo documento como attachment `resender-openapi-v1.json`                   |

Implementación requerida:

- Usar `OpenAPIHono`, `createRoute` y `z` desde `@hono/zod-openapi`.
- Usar `swaggerUI({ url: "/openapi.json" })` desde `@hono/swagger-ui`.
- Generar un único documento en runtime; JSON, descarga y Swagger consumen exactamente el mismo objeto.
- OpenAPI `3.1.0`, `info.version: 1.0.0`, servidor productivo y servidor local.
- Declarar `bearerAuth`, todos los responses, ejemplos, headers de idempotencia, paginación y rate limit.
- Añadir un test snapshot del documento y fallar CI ante rutas no documentadas de `/v1`.
- El documento descargable contiene la API para clientes; los callbacks de Meta/Stripe y el RPC interno se documentan aquí, pero no forman parte del OpenAPI público.

### Identidad

#### `GET /v1/me`

Valida la key y facilita un smoke test.

Respuesta `200`:

```json
{
  "data": {
    "tenantId": "uuid",
    "plan": {
      "status": "active",
      "lookupKey": "starter"
    }
  }
}
```

No devuelve email, billing customer ID ni datos de la API key.

### Pages

En la API v1, `pageId` significa siempre el UUID interno de Resender. El ID externo se llama `providerPageId`.

| Método | Ruta                                       | Descripción                                |
| ------ | ------------------------------------------ | ------------------------------------------ |
| GET    | `/v1/pages`                                | Lista Pages conectadas                     |
| GET    | `/v1/pages/{pageId}`                       | Obtiene una Page                           |
| PATCH  | `/v1/pages/{pageId}`                       | Actualiza configuración de entrega         |
| POST   | `/v1/pages/{pageId}/webhook-secret/rotate` | Rota y muestra una vez el secreto de firma |

Filtros de lista:

- `status=active|disconnected`
- `channel=messenger|instagram`
- `limit`
- `cursor`

`channel` es un campo aparte de `provider`, no un valor suyo: Instagram es Meta, así que `provider` sigue en `"meta"` en los dos y lo que cambia es la superficie. `username` es el @handle de Instagram y va `null` en Messenger. Decisión en `docs/adr/0008-instagram-como-segundo-canal.md`.

DTO de Page:

```json
{
  "id": "7ac2...uuid",
  "provider": "meta",
  "channel": "messenger",
  "providerPageId": "10987654321",
  "name": "Acme",
  "username": null,
  "status": "active",
  "tokenStatus": "valid",
  "webhook": {
    "url": "https://example.com/webhooks/resender",
    "signingEnabled": true
  },
  "connectedAt": "2026-07-29T18:00:00.000Z",
  "updatedAt": "2026-07-29T18:00:00.000Z"
}
```

`PATCH /v1/pages/{pageId}`:

```json
{
  "webhookUrl": "https://example.com/webhooks/resender"
}
```

- `webhookUrl: null` desactiva la entrega externa.
- Solo se acepta HTTPS en producción.
- Se bloquean loopback, link-local y destinos privados para reducir SSRF; la validación se repite al consumir el Queue.
- No permite conectar/desconectar Meta: esa operación requiere el OAuth interactivo del dashboard y queda en RPC.

`POST /v1/pages/{pageId}/webhook-secret/rotate` devuelve una sola vez:

```json
{
  "data": {
    "secret": "whsec_...",
    "createdAt": "2026-07-29T18:00:00.000Z"
  }
}
```

El secreto debe generarse con Web Crypto y guardarse cifrado, no en claro. Rotar invalida inmediatamente el anterior en v1.

### Conversations

| Método | Ruta                                          | Descripción                       |
| ------ | --------------------------------------------- | --------------------------------- |
| GET    | `/v1/conversations`                           | Lista conversaciones/contactos    |
| GET    | `/v1/conversations/{conversationId}`          | Obtiene una conversación          |
| GET    | `/v1/conversations/{conversationId}/messages` | Lista mensajes de la conversación |

Filtros:

- `pageId`
- `updatedAfter`
- `limit`
- `cursor`

DTO de Conversation:

```json
{
  "id": "uuid",
  "page": {
    "id": "uuid",
    "providerPageId": "10987654321",
    "name": "Acme"
  },
  "contact": {
    "id": "page-scoped-psid",
    "name": "Ada"
  },
  "latestMessage": {
    "id": "uuid",
    "text": "Hola",
    "direction": "inbound",
    "status": "received",
    "createdAt": "2026-07-29T18:00:00.000Z"
  },
  "lastMessageAt": "2026-07-29T18:00:00.000Z",
  "createdAt": "2026-07-20T18:00:00.000Z",
  "updatedAt": "2026-07-29T18:00:00.000Z"
}
```

La API permite “ver clientes” mediante `conversation.contact`. No se crea `/v1/contacts`: el mismo PSID puede tener significado únicamente dentro de una Page y todavía no existe una entidad de contacto independiente.

### Messages

| Método | Ruta                                  | Descripción                                      |
| ------ | ------------------------------------- | ------------------------------------------------ |
| POST   | `/v1/messages`                        | Envía un mensaje de texto por Meta               |
| GET    | `/v1/messages`                        | Lista mensajes del tenant                        |
| GET    | `/v1/messages/{messageId}`            | Obtiene un mensaje                               |
| GET    | `/v1/messages/{messageId}/deliveries` | Lista intentos de entrega al webhook del cliente |

Filtros de `GET /v1/messages`:

- `pageId`
- `conversationId`
- `direction=inbound|outbound`
- `status=received|sent|failed`
- `createdAfter`
- `createdBefore`
- `limit`
- `cursor`

`GET /v1/conversations/{conversationId}/messages` acepta `limit` y `cursor` y también ordena de más reciente a más antiguo.

DTO público de Message:

```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "pageId": "uuid",
  "contactId": "page-scoped-psid",
  "direction": "outbound",
  "status": "sent",
  "type": "text",
  "text": "Hola desde Resender",
  "provider": {
    "name": "meta",
    "messageId": "mid...."
  },
  "failure": null,
  "createdAt": "2026-07-29T18:00:00.000Z"
}
```

`POST /v1/messages`:

```http
POST /v1/messages
Authorization: Bearer pk_live_...
Idempotency-Key: order_42_confirmation
Content-Type: application/json
```

```json
{
  "pageId": "connected-page-uuid",
  "recipientId": "page-scoped-psid",
  "conversationId": "optional-conversation-uuid",
  "type": "text",
  "text": "Tu pedido está listo"
}
```

Decisiones del contrato:

- `Idempotency-Key` es obligatorio, no vacío y de máximo 200 caracteres.
- Se guarda un fingerprint del payload. Misma key + mismo payload devuelve el resultado almacenado sin llamar a Meta ni consumir cuota.
- Misma key + payload distinto responde `409 idempotency_conflict`.
- `pageId` es UUID interno; el endpoint legado usa el ID de Meta, pero no se perpetúa esa ambigüedad en v1.
- Si se envía `conversationId`, debe corresponder a la misma Page y `recipientId`.
- El envío a Meta sigue siendo síncrono en v1. La Queue de esta fase es para entregar eventos entrantes a los clientes, no para enviar mensajes a Meta.
- Éxito nuevo: `201`.
- Replay idempotente: `200` y header `Idempotent-Replayed: true`.
- Rechazo funcional de Meta: `422`; indisponibilidad transitoria: `502`. En ambos casos se persiste un mensaje `failed` y el error incluye su `messageId` en `details`.

`GET /v1/messages/{messageId}/deliveries` devuelve metadatos estables, nunca el secreto ni todo el body:

```json
{
  "data": [
    {
      "id": "uuid",
      "eventId": "evt_...",
      "attempt": 1,
      "status": "success",
      "statusCode": 200,
      "error": null,
      "attemptedAt": "2026-07-29T18:00:02.000Z"
    }
  ],
  "pagination": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

### Comments

Los comentarios de Instagram son un recurso propio y no una variante de `/v1/messages`, por la misma razón por la que tienen tabla propia: cuelgan de una publicación, se anidan y su respuesta pública no tiene ventana de 24 horas. `{commentId}` es el UUID interno de Resender, igual que el resto de v1.

| Método | Ruta                                        | Descripción                                    |
| ------ | ------------------------------------------- | ---------------------------------------------- |
| GET    | `/v1/comments`                              | Lista, filtrable por `pageId`, `mediaId` y dirección |
| GET    | `/v1/comments/{commentId}`                  | Obtiene un comentario                          |
| GET    | `/v1/comments/{commentId}/deliveries`       | Bitácora de entregas, misma forma que la de mensajes |
| POST   | `/v1/comments/{commentId}/replies`          | Respuesta **pública** bajo la publicación      |
| POST   | `/v1/comments/{commentId}/private-replies`  | **DM** a quien comentó, uno solo por comentario |

Las dos respuestas comparten cubeta de rate limit con `POST /v1/messages`: son la misma clase de operación —salir hacia Graph por cada evento entrante— y con cubetas separadas un tenant podría duplicar su presión sobre Meta sin tocar su límite de mensajes. La respuesta privada se persiste en `messages` con `sourceCommentId`, no en la tabla de comentarios.

### Endpoints de proveedores

Estos endpoints son públicos en red, pero no se autentican con API key ni se incluyen en el OpenAPI para clientes:

| Método | Ruta                        | Verificación                                            |
| ------ | --------------------------- | ------------------------------------------------------- |
| GET    | `/webhooks/meta`            | challenge y verify token                                |
| POST   | `/webhooks/meta`            | firma `X-Hub-Signature-256` con comparación timing-safe |
| GET    | `/webhooks/meta/instagram`  | challenge y verify token **propio** de Instagram        |
| POST   | `/webhooks/meta/instagram`  | firma `X-Hub-Signature-256` con `INSTAGRAM_APP_SECRET`  |
| POST   | `/webhooks/stripe`          | firma Stripe sobre el body crudo                        |

Instagram tiene ruta propia porque **el secreto que firma es otro**: compartirla obligaría a adivinar con cuál verificar cada payload, o a probar los dos, que es peor.

Los límites de body deben ser explícitos. Ninguno debe parsear o registrar el body antes de verificar su firma.

### Webhook saliente de Resender

Flujo:

```text
Meta
  -> POST /webhooks/meta
  -> validar firma
  -> localizar Page/tenant
  -> transacción: deduplicar + persistir mensaje + crear job pendiente
  -> publicar { deliveryId, messageId } en webhook-deliveries
  -> responder 200 a Meta

webhook-deliveries Queue
  -> cargar job/payload/destino desde DB
  -> comprobar que no esté entregado
  -> firmar body
  -> POST al webhook del cliente
  -> guardar intento
  -> ack, retry con delay o fallo permanente
  -> DLQ al agotar reintentos
```

Payload:

```json
{
  "id": "evt_01J...",
  "type": "message.received",
  "createdAt": "2026-07-29T18:00:00.000Z",
  "data": {
    "page": {
      "id": "uuid",
      "providerPageId": "10987654321",
      "name": "Acme"
    },
    "conversation": {
      "id": "uuid",
      "contact": {
        "id": "page-scoped-psid",
        "name": "Ada"
      }
    },
    "message": {
      "id": "uuid",
      "direction": "inbound",
      "status": "received",
      "type": "text",
      "text": "Hola",
      "provider": {
        "name": "meta",
        "messageId": "mid..."
      },
      "createdAt": "2026-07-29T18:00:00.000Z"
    }
  }
}
```

Headers de firma:

```text
Resender-Event-Id: evt_01J...
Resender-Timestamp: 1785348000
Resender-Signature: v1=<hex-hmac-sha256>
```

Contenido firmado, usando los bytes exactos enviados:

```text
<eventId>.<timestamp>.<rawJsonBody>
```

El receptor usa `Resender-Event-Id` como clave de idempotencia. El mismo evento puede llegar más de una vez porque Cloudflare Queues ofrece entrega at-least-once.

Política de resultado:

- `2xx`: guardar éxito y `ack`.
- `408`, `429`, `5xx`, timeout o error de red: guardar intento y `retry` con delay.
- Otros `4xx`: guardar fallo permanente y `ack`.
- Al superar reintentos: Cloudflare mueve el mensaje a `webhook-deliveries-dlq`.
- El consumidor de DLQ marca el job `dead`, registra un error estructurado y dispara la alerta configurada.

## Diseño RPC interno

El API exporta:

```ts
export class WebAppApi extends WorkerEntrypoint<Env> {
  // métodos públicos RPC
}
```

`web` lo consumirá en fase 2 con un Service Binding que especifica `entrypoint: "WebAppApi"`.

El RPC no debe exponer SQL genérico ni duplicar cada endpoint HTTP. Sus métodos representan casos de uso del producto y devuelven DTOs serializables de `packages/contracts`.

Contrato mínimo que debe existir y estar probado en fase 1:

```ts
type RpcActor = {
  userId: string
}

interface WebAppApiContract {
  authenticateCredentials(input: {
    email: string
    password: string
  }): Promise<AuthenticatedUserDto | null>

  registerUser(input: {
    email: string
    password: string
  }): Promise<AuthenticatedUserDto>

  getProductAccess(actor: RpcActor): Promise<ProductAccessDto>
  getProductShell(actor: RpcActor): Promise<ProductShellDto>

  listConversations(
    actor: RpcActor,
    input: ConversationListInput
  ): Promise<ConversationListDto>

  getConversationThread(
    actor: RpcActor,
    input: { conversationId: string }
  ): Promise<ConversationThreadDto>

  listPages(actor: RpcActor): Promise<PageDto[]>
  listAuthorizedMetaPages(
    actor: RpcActor,
    input: { userAccessToken: string }
  ): Promise<AuthorizedMetaPageDto[]>
  connectMetaPages(
    actor: RpcActor,
    input: ConnectMetaPagesInput
  ): Promise<PageDto[]>
  disconnectPage(actor: RpcActor, input: { pageId: string }): Promise<PageDto>
  updatePageWebhook(
    actor: RpcActor,
    input: { pageId: string; webhookUrl: string | null }
  ): Promise<PageDto>
  exchangeMetaAuthorizationCode(
    actor: RpcActor,
    input: { code: string; redirectUri: string }
  ): Promise<MetaAuthorizationResultDto>

  listApiKeys(actor: RpcActor): Promise<ApiKeyDto[]>
  createApiKey(
    actor: RpcActor,
    input: { label: string }
  ): Promise<CreatedApiKeyDto>
  revokeApiKey(actor: RpcActor, input: { apiKeyId: string }): Promise<void>

  getBillingState(actor: RpcActor): Promise<BillingStateDto>
  createCheckoutSession(
    actor: RpcActor,
    input: { priceLookupKey: string; returnUrl: string }
  ): Promise<{ url: string }>
  createBillingPortalSession(
    actor: RpcActor,
    input: { returnUrl: string }
  ): Promise<{ url: string }>

  changePassword(
    actor: RpcActor,
    input: { currentPassword: string; newPassword: string }
  ): Promise<void>
  deleteAccount(actor: RpcActor): Promise<AccountDeletionResultDto>
}
```

Notas obligatorias:

- Revisar el frontend real antes de congelar las firmas; agregar cualquier caso de uso faltante, no métodos CRUD genéricos.
- El backend valida que `actor.userId` exista y que cada recurso pertenezca a ese usuario.
- No aceptar `tenantId` arbitrario junto con `actor`; en el modelo actual el `userId` es el tenant.
- Los errores RPC usan clases/códigos serializables definidos en contratos; `web` los traduce a UX.
- No enviar secretos de larga duración salvo los resultados que deben mostrarse una sola vez.
- No compartir `Date` ni clases de dominio: usar strings/objetos simples.

## Persistencia y cambios de esquema

Durante fase 1 las migraciones productivas continúan ejecutándose desde el pipeline actual de `web`. No se deben mantener dos directorios canónicos.

Crear la siguiente migración consecutiva en `apps/web/db/migrations` —esto no cambia el frontend, solo amplía el esquema— y mover el ownership físico a `apps/api` en fase 2:

1. `external_webhook_jobs`
   - `id`, `event_id` único, `tenant_id`, `message_id`.
   - snapshot de `webhook_url` y payload JSON versionado.
   - `status`: `pending|processing|succeeded|failed_permanent|dead`.
   - `attempt_count`, `last_status_code`, `last_error`.
   - timestamps y `delivered_at`.
   - unique por evento/message para deduplicación.
2. Mantener `external_webhook_deliveries` como tabla append-only de intentos y relacionarla con `job_id`/`event_id`.
3. Agregar `webhook_signing_secret_encrypted` y fecha de rotación a `connected_pages`.
4. Agregar `idempotency_fingerprint` a `messages`.
5. Índices para consultas por tenant/cursor y para barrer jobs `pending`.

Requisitos:

- La persistencia del mensaje entrante y la creación del job se realizan atómicamente.
- El mensaje enviado al Queue contiene solo `{ deliveryId, messageId }`.
- Si DB confirma pero `Queue.send()` falla, responder `500` a Meta. En el retry de Meta, la rama deduplicada debe localizar y volver a encolar el job pendiente.
- Añadir un `scheduled` recovery sweep que vuelva a encolar jobs `pending` antiguos. Esto cierra el hueco si Meta no reintenta.
- La operación del consumer es idempotente: un job `succeeded` se confirma sin volver a hacer `fetch`.
- En tests y desarrollo se usa una base o branch de Neon separada de producción.

## Configuración Cloudflare

Recursos:

- Worker: `api` y variante staging.
- Custom domain final: `api.resender.dev` (puede reservarse en fase 1; no se anuncian aún los callbacks).
- Queue: `webhook-deliveries`.
- DLQ: `webhook-deliveries-dlq`.
- Producer y consumers configurados en `apps/api/wrangler.jsonc`.

Configuración mínima:

- `compatibility_date` igual a la fecha de implementación.
- `compatibility_flags: ["nodejs_compat"]`.
- `observability.enabled: true`.
- `observability.logs.enabled: true`.
- `observability.traces.enabled: true`.
- Sampling 100% en staging; valor productivo explícito y revisado según tráfico/costo.
- `placement.mode: "smart"` mientras se use PostgreSQL externo.
- Un Rate Limiting binding de Cloudflare para `/v1`, keyed por tenant/API key + familia de ruta. No implementar contadores exactos en memoria global; el binding es protección técnica y no reemplaza la cuota persistida de billing.
- Generar tipos con `wrangler types`; no escribir `Env` manualmente.
- Secretos mediante `wrangler secret`, nunca en JSONC:
  - `DATABASE_URL`
  - `AUTH_SECRET`/pepper compatible para verificar keys y passwords existentes
  - `TOKEN_ENCRYPTION_KEY`
  - `META_APP_SECRET`
  - `META_VERIFY_TOKEN`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - PostHog si continúa en backend

Antes de escribir el JSONC, validar cada campo contra `node_modules/wrangler/config-schema.json`.

No inventar IDs de Queues o bindings. Crearlos con Wrangler en staging y producción y registrar sus nombres exactos en configuración/IaC.

### Presupuesto operativo

Precios verificados el 29 de julio de 2026; volver a comprobarlos antes del despliegue:

- El plan Workers Paid conserva un mínimo de USD 5/mes.
- Incluye 1,000,000 de operaciones de Queues al mes; el excedente cuesta USD 0.40 por millón.
- Una entrega normal menor de 64 KB consume normalmente tres operaciones: write, read y delete. Cada retry suma al menos una lectura.
- Las llamadas por Service Binding/RPC no agregan otro request facturable; Cloudflare agrega el CPU utilizado por ambos Workers a la invocación original.
- Logs y traces también tienen una cuota. Ajustar sampling y alertas de gasto con datos reales, no deshabilitar observabilidad.

El diseño de mensajes mínimos `{ deliveryId, messageId }`, retries selectivos y `ack` individual también limita el costo de Queues.

## Plan de implementación

### 1. Baseline y caracterización

- [ ] Ejecutar test, lint, typecheck y build actuales; guardar resultados.
- [ ] Inventariar todos los imports de `getSql`, `DATABASE_URL`, Meta, Stripe, API keys, billing y crypto dentro de `apps/web`.
- [ ] Escribir tests de caracterización para reglas críticas que aún no tengan cobertura.
- [ ] Confirmar todos los DTOs que consume hoy cada página/Server Action; esto alimenta el contrato RPC.
- [ ] Registrar explícitamente cualquier diferencia entre el código y la documentación actual.

### 2. Scaffolding del monorepo

- [ ] Crear `apps/api` y `packages/contracts`.
- [ ] Añadir scripts `dev`, `test`, `typecheck`, `lint`, `deploy`, `deploy:staging`, `cf-typegen`.
- [ ] Verificar que los workspaces `apps/*` y `packages/*` los detecten sin configuración paralela.
- [ ] Actualizar Turbo solo para incluir las tareas nuevas, sin cambiar el runtime de `web`.
- [ ] Instalar versiones compatibles y fijadas de `hono`, `@hono/zod-openapi`, `@hono/swagger-ui`, `zod`, Wrangler y el pool de Vitest para Workers.
- [ ] Exportar default handler con `fetch`, `queue` y `scheduled`, más el named export `WebAppApi`.

### 3. Contratos y capa de aplicación

- [ ] Crear esquemas Zod y DTOs en `packages/contracts`.
- [ ] Definir error taxonomy HTTP/RPC.
- [ ] Extraer casos de uso puros y puertos de repositorio/proveedor.
- [ ] Portar adaptadores SQL a `apps/api`; no moverlos a contratos.
- [ ] Portar Meta, Stripe, crypto, billing, API keys y PostHog conservando reglas.
- [ ] Evitar estado mutable por request a nivel módulo.
- [ ] Await/return/waitUntil para toda Promise; no dejar operaciones flotantes.

### 4. Hono, API pública y OpenAPI

- [ ] Implementar middleware de request context, body limits, auth, rate limit, error mapping y logging estructurado.
- [ ] Implementar todos los endpoints aprobados.
- [ ] Crear el documento OpenAPI desde los mismos esquemas que validan runtime.
- [ ] Implementar `/docs`, `/openapi.json` y `/openapi/download`.
- [ ] Añadir examples de curl y respuestas a Swagger.
- [ ] Verificar que ningún secreto o campo interno aparezca en schemas/examples.

### 5. RPC

- [ ] Implementar `WebAppApi extends WorkerEntrypoint`.
- [ ] Hacer que HTTP y RPC llamen a los mismos casos de uso.
- [ ] Probar serialización de éxitos y errores.
- [ ] Probar aislamiento de tenant y ownership en cada método.
- [ ] No configurar todavía el binding en `apps/web`.

### 6. Queue y callbacks

- [ ] Crear migración de outbox/jobs, firmas e idempotency fingerprint.
- [ ] Implementar callback Meta con verificación sobre body crudo y comparación timing-safe.
- [ ] Persistir mensaje + job atómicamente, publicar IDs y responder rápido.
- [ ] Implementar consumer por mensaje con `ack`/`retry`; evitar que un fallo reintente todo el batch.
- [ ] Implementar firma HMAC del webhook saliente.
- [ ] Implementar consumidor de DLQ y recovery sweep.
- [ ] Portar Stripe webhook con verificación sobre body crudo e idempotencia.
- [ ] Mantener sin cambios las URLs de proveedores en producción.

### 7. Observabilidad

- [ ] Log JSON con `worker`, `entrypoint`, `requestId`, `tenantId` cuando sea seguro, `route`, `status`, `durationMs` y código de error.
- [ ] Correlacionar callback Meta, job, evento, mensaje e intentos.
- [ ] No registrar Authorization, cookies, firmas, tokens, passwords, body completo ni texto de mensajes por defecto.
- [ ] Habilitar logs/traces separados para `api`.
- [ ] Crear consultas/alertas para 5xx, DLQ, backlog, rate de fallos y latencia de proveedor.

### 8. Desarrollo local

El objetivo obligatorio es:

```bash
npm run dev
```

Debe iniciar en paralelo:

- `apps/web`: `next dev`, normalmente `http://localhost:3000`.
- `apps/api`: `wrangler dev`, normalmente `http://localhost:8787`.

Requisitos:

- `.dev.vars` separado por app y excluido de git.
- `.dev.vars.example` sin valores secretos.
- DB/branch local o de desarrollo, nunca producción.
- Queues simuladas por Wrangler local.
- El RPC se prueba en el pool Workers en fase 1; la comunicación real `web -> api` se activa en fase 2.
- Para callbacks externos usar Cloudflare Tunnel/ngrok y Stripe CLI; Meta y Stripe no pueden llamar directamente a localhost.
- Agregar un flujo `npm run preview`/integración para OpenNext compilado y runtime Workers, además del HMR de `next dev`.

### 9. CI y staging

- [ ] Lint, typecheck, unit, Worker integration y OpenAPI snapshot.
- [ ] Smoke tests contra staging para health, auth inválida, envío idempotente y callbacks firmados.
- [ ] Desplegar `api` staging con DB y proveedores de prueba.
- [ ] Crear Queue/DLQ de staging; no reutilizar producción.
- [ ] Desplegar `api` productivo sin cambiar tráfico del frontend ni callbacks.
- [ ] Verificar logs de `web` y `api` por separado en Cloudflare.

## Estrategia de pruebas

Cobertura mínima:

- API key válida, inválida, revocada y actualización de `lastUsedAt`.
- Aislamiento entre dos tenants para todos los recursos.
- Validación Zod y envelopes de error.
- Cursor estable sin duplicados/omisiones.
- Idempotencia concurrente y conflicto de fingerprint.
- Todos los gates de waitlist/subscription/quota/plan.
- Page ownership y token inválido.
- Meta success, rechazo funcional, timeout y error transitorio.
- Firma válida/inválida de Meta y Stripe con body crudo.
- Deduplicación de inbound.
- Fallo de `Queue.send()` después del commit y re-encolado en webhook duplicado.
- Consumer duplicado sobre job ya exitoso.
- `2xx`, `408`, `429`, `4xx` permanente, `5xx`, timeout, retry y DLQ.
- Firma saliente reproducible sobre los bytes exactos.
- Recovery sweep.
- OpenAPI contiene todos los endpoints `/v1` y Swagger carga el JSON.
- RPC ownership, serialización y error mapping.

No hacer llamadas reales a Meta/Stripe en tests automáticos; usar adapters/fakes. Staging sí puede ejecutar un smoke controlado.

## Criterios de aceptación de fase 1

- [ ] `npm run dev` levanta `web` y `api` sin configuración manual adicional después de crear `.dev.vars`.
- [ ] `apps/web` conserva su comportamiento, handlers y acceso a DB.
- [ ] `api` se despliega y tiene logs/traces separados.
- [ ] Toda la API v1 aprobada responde en staging.
- [ ] `/docs` renderiza Swagger usando `/openapi.json`.
- [ ] `/openapi/download` descarga el mismo documento validado.
- [ ] El RPC nombrado compila, se prueba y no tiene URL pública propia.
- [ ] El callback Meta nuevo persiste, encola y responde sin esperar al webhook del cliente.
- [ ] Retry, idempotencia, DLQ y recovery están probados.
- [ ] Stripe webhook nuevo está probado pero producción continúa apuntando a `web`.
- [ ] Ninguna API key, token o secreto llega a bundle/browser/log.
- [ ] Migraciones son backward-compatible con el `web` actual.
- [ ] CI completo está verde.
- [ ] Se registran métricas baseline para comparar antes del cutover.

## No hacer

- No crear dos backends o dos repositorios de lógica: API HTTP y RPC viven en `apps/api`.
- No proteger rutas internas con `X-Internal-Secret`.
- No hacer que `web` consuma la API pública con una API key de cliente.
- No publicar secretos en variables `vars`, repositorio o OpenAPI.
- No usar `setTimeout` dentro de una request para retries de webhooks.
- No mandar payloads o secretos completos en el Queue si se pueden resolver por ID.
- No responder `200` a Meta si la persistencia o el handoff inicial al Queue falló.
- No borrar handlers antiguos en esta fase.
- No mover simultáneamente la conexión a Hyperdrive.

## Rollback

Fase 1 es aditiva:

- Los callbacks productivos siguen en `web`, por lo que un fallo del nuevo Worker no afecta el producto actual.
- Se puede retirar la ruta/custom domain del Worker `api` sin rollback de `web`.
- Las migraciones deben ser aditivas y compatibles; no eliminar ni renombrar columnas.
- No purgar Queues durante rollback. Pausar el consumer, inspeccionar backlog y reanudar o replay de forma controlada.

## Entregables para handoff

- Código de `apps/api` y `packages/contracts`.
- Migración SQL y documentación de rollback.
- OpenAPI snapshot generado y ejemplos de curl.
- Runbook de secrets/bindings/Queues por ambiente.
- Runbook de DLQ y replay.
- Evidencia de tests y staging.
- Inventario final de consumidores directos de DB en `web` para ejecutar fase 2.

## Referencias vigentes

- [Hono: Zod OpenAPI](https://hono.dev/examples/zod-openapi)
- [Hono: Swagger UI](https://hono.dev/examples/swagger-ui)
- [Cloudflare Service Bindings RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Cloudflare Queues: batching, retries and delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Cloudflare Queues: Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [Cloudflare local development with multiple Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/)
- [Cloudflare Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Cloudflare Workers and Service Bindings pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Wrangler `getPlatformProxy`](https://developers.cloudflare.com/workers/wrangler/api/)
- [OpenNext Cloudflare bindings](https://opennext.js.org/cloudflare/bindings)
- [Workers observability and traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
