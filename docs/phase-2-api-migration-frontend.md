# Fase 2 — API migration/frontend

> **Superado por [ADR 0012](./adr/0012-un-solo-worker-next-sin-api-separada.md)
> (21-ago-2026).** La separación no se hizo: `apps/api` se borró sin haberse
> desplegado nunca, y la entrega durable que diseñaba este plan vive ahora en el
> Worker `web`. Este documento queda como histórico de por qué se intentó y qué
> se rescató. El diseño completo está en el tag `arquitectura/api-worker-phase-1`.

## Estado del documento

- **Objetivo:** migrar el Worker Next `web` para que consuma el backend mediante RPC y deje de ser dueño de DB, integraciones y API pública.
- **Prerrequisito:** todos los criterios de aceptación de [Fase 1 — API migration](./phase-1-api-migration.md) deben estar completos.
- **Resultado final:** dos Workers con ownership claro, logs separados y sin acceso directo del frontend a PostgreSQL.

## Arquitectura final

```text
Developers
  |
  | HTTPS + API key
  v
api.resender.dev
  Worker api (Hono)
  |-- /v1
  |-- /webhooks/meta
  |-- /webhooks/stripe
  |-- WebAppApi RPC
  |-- Queues/DLQ/scheduled
  `-- único dueño de DB, Meta, Stripe, tokens, API keys y reglas

Browser
  |
  v
resender.dev
  Worker web (Next/OpenNext)
  |-- UI, RSC, Server Actions, BFF
  |-- NextAuth JWT/cookie
  |-- OAuth state/cookies, redirects y revalidation
  `-- Service Binding BACKEND -> api:WebAppApi
```

Regla central:

> Después del cutover, ningún componente de `apps/web` abre conexiones a PostgreSQL ni conoce secretos de Meta, Stripe, cifrado de tokens o API keys.

El navegador tampoco llama directamente al RPC ni recibe una API key. Las interacciones siguen entrando por páginas, Server Components, Server Actions o handlers BFF de Next; esos adaptadores llaman a `env.BACKEND`.

## Ownership final

| Responsabilidad                  | `web` |       `api` |
| -------------------------------- | ----: | ----------: |
| UI, marketing, docs de producto  |    Sí |          No |
| NextAuth cookie/JWT              |    Sí |          No |
| Redirects, OAuth state/cookies   |    Sí |          No |
| Revalidation y UX de formularios |    Sí |          No |
| API pública `/v1`                |    No |          Sí |
| Verificación de credenciales     |    No | Sí, vía RPC |
| PostgreSQL y migraciones         |    No |          Sí |
| API keys, cuotas y entitlement   |    No |          Sí |
| Page tokens y cifrado            |    No |          Sí |
| Meta Graph API                   |    No |          Sí |
| Stripe API y webhook             |    No |          Sí |
| Callbacks Meta/Stripe            |    No |          Sí |
| Queue de webhooks y DLQ          |    No |          Sí |
| Casos de uso y reglas de dominio |    No |          Sí |

`packages/contracts` contiene únicamente DTOs/esquemas/errores compartidos. No se crea un `packages/core` que permita a `web` saltarse el API.

## Alcance

### Incluido

- Añadir Service Binding nombrado `BACKEND` desde `web` al entrypoint `WebAppApi`.
- Crear un adapter tipado y único para RPC dentro de `apps/web`.
- Migrar por slices todas las lecturas y mutaciones del producto.
- Migrar verificación/registro de credenciales de NextAuth.
- Mantener en Next solo estado OAuth/cookies/redirect; mover exchange y persistencia de tokens al backend.
- Mover creación de sesiones de Stripe al backend.
- Reapuntar callbacks productivos de Meta y Stripe.
- Actualizar documentación/marketing/curls a `https://api.resender.dev/v1`.
- Eliminar handlers, SQL, repositorios y secretos de backend del Worker `web`.
- Transferir ownership de migraciones y orden de despliegue a `apps/api`.

### Fuera de alcance

- Rediseñar la UI.
- Cambiar proveedor de auth o estrategia JWT.
- Añadir scopes/ambientes a las API keys.
- Introducir GraphQL, tRPC o llamadas HTTP internas.
- Migrar PostgreSQL a otro proveedor.
- Añadir Hyperdrive dentro del cutover; hacerlo en un cambio posterior medido.
- Que el navegador consuma la API pública para operar el dashboard.

## Prerrequisitos obligatorios

Antes de empezar:

- [ ] Fase 1 desplegada en staging y productivo sin recibir aún los callbacks productivos.
- [ ] OpenAPI v1 aprobado por Arturo.
- [ ] Contrato `WebAppApi` cubre todos los casos de uso reales del frontend.
- [ ] Queue, DLQ, recovery y webhook signing probados.
- [ ] Migraciones aditivas aplicadas y compatibles con `web`.
- [ ] Dashboards/alertas de `api` funcionando.
- [ ] Baseline de tráfico, errores y latencia guardado.
- [ ] Runbook de rollback probado en staging.
- [ ] Leer las guías pertinentes en `node_modules/next/dist/docs/` antes de modificar RSC, Server Actions, route handlers, caching o auth.

## Integración RPC

### Configuración

Agregar a la configuración Wrangler de `apps/web`, por ambiente:

```jsonc
{
  "services": [
    {
      "binding": "BACKEND",
      "service": "api",
      "entrypoint": "WebAppApi",
    },
  ],
}
```

Los nombres de staging deben apuntar al Worker de staging. Los bindings no heredables se repiten explícitamente por ambiente.

Después:

- Ejecutar `wrangler types` para `web` y `api`.
- No escribir a mano el tipo del binding `Env`.
- Crear un adapter server-only, por ejemplo `apps/web/lib/backend/backend.ts`.
- Obtener bindings mediante el mecanismo OpenNext soportado por esta versión.
- El adapter no debe poder importarse desde Client Components.
- Mantener traducción centralizada de errores RPC a errores de formulario, `notFound`, redirect o página de error.

### Identidad

Patrón de llamada:

```text
Browser
  -> Next verifica la sesión JWT/cookie
  -> Next construye actor { userId: session.user.id }
  -> env.BACKEND.metodo(actor, input)
  -> api valida usuario + ownership + regla
  -> DTO o error tipado
```

No pasar `tenantId` recibido del browser. No usar API keys de cliente. No agregar un “service secret”.

Para login con Credentials, no existe aún una sesión:

```text
authorize(credentials)
  -> env.BACKEND.authenticateCredentials({ email, password })
  -> usuario mínimo para crear JWT
```

`web` conserva `AUTH_SECRET` para firmar/verificar su sesión. El hash de passwords y la consulta de usuarios viven en `api`.

## Estrategia de migración

No hacer big bang. Cada slice sigue el mismo patrón:

1. Confirmar que el método RPC y tests ya están desplegados.
2. Cambiar un consumidor de `web`.
3. Validar local, preview y staging.
4. Desplegar `api` primero y después `web`.
5. Observar errores/latencia.
6. Quitar el camino SQL anterior de ese slice; no mantener fallback silencioso permanente.

Los contratos RPC deben ser backward-compatible durante el rollout: agregar campos opcionales antes de hacerlos requeridos, y no retirar métodos hasta que el `web` productivo que los usaba haya desaparecido.

## Orden de ejecución

### Slice 0 — Binding y smoke test

- [ ] Configurar `BACKEND` local, staging y producción.
- [ ] Generar tipos.
- [ ] Implementar adapter server-only.
- [ ] Crear una llamada de health/product access no visible para probar el binding.
- [ ] Verificar que `npm run dev` conecte `next dev` con el Wrangler local del Worker llamado `api`.
- [ ] Verificar preview compilado de OpenNext con el binding real.
- [ ] Medir latencia y confirmar trazas `web -> api`.

No cambiar UI ni borrar SQL en este slice.

### Slice 1 — Shell y gates del producto

Migrar:

- Acceso de producto/waitlist.
- Estado de suscripción/entitlement.
- Conteos que alimentan navegación o shell.

Acciones:

- [ ] Reemplazar queries directas por `getProductAccess`/`getProductShell`.
- [ ] Conservar redirects y rendering en Next.
- [ ] Probar usuario waitlisted, sin suscripción, restringido y activo.
- [ ] Eliminar imports SQL ya sin uso.

### Slice 2 — Conversations y Messages

Migrar:

- Lista de conversaciones.
- Thread de mensajes.
- Filtros y estados vacíos/error.
- Cualquier detalle de entregas mostrado en consola.

Acciones:

- [ ] Consumir DTOs RPC, no endpoints públicos HTTP.
- [ ] Mantener formateo/locale en `web`.
- [ ] Evitar mandar texto de mensajes a logs.
- [ ] Comparar resultados RPC contra SQL en staging con fixtures conocidos.
- [ ] Eliminar read models SQL de `web` al terminar el slice.

### Slice 3 — Connections/Pages

Migrar:

- Listado de Pages.
- Update de webhook URL.
- Disconnect/reconnect.
- Token health mostrado en UI.
- Rotación/visualización única del webhook signing secret si la UX lo ofrece.

Acciones:

- [ ] Mantener formularios, redirects, cookies y revalidation en Next.
- [ ] Ejecutar operaciones de Meta, tokens y DB exclusivamente en `api`.
- [ ] Probar ownership y límites de Pages por plan.
- [ ] Probar SSRF validation de webhook URL.
- [ ] No devolver Page access tokens a `web`.

### Slice 4 — API keys y Settings

Migrar:

- List/create/revoke API keys.
- Cambio de password.
- Eliminación de cuenta.
- Datos de settings que provengan de DB.

Acciones:

- [ ] Mostrar una nueva API key solo en la respuesta de creación.
- [ ] Nunca persistir o loggear el secreto en `web`.
- [ ] Revalidar sesión/credenciales donde corresponda.
- [ ] Probar delete account y compensaciones externas.
- [ ] Eliminar pepper/hash helpers de `web`.

### Slice 5 — Billing

Migrar:

- Lectura del estado billing.
- Creación de Checkout Session.
- Creación de Billing Portal Session.
- Cualquier cancelación/cleanup de cuenta.

Acciones:

- [ ] `web` envía solo `priceLookupKey`/return URLs permitidas.
- [ ] `api` valida allowlist de precios y URLs.
- [ ] Mantener redirects en Next.
- [ ] Mover Stripe secret key al Worker `api`.
- [ ] No reapuntar aún el webhook hasta el slice de callbacks.

### Slice 6 — Auth Credentials

Migrar:

- Registro.
- Verificación de email/password de NextAuth.
- Waitlist asociado a auth.

Acciones:

- [ ] `authorize` llama `authenticateCredentials` por binding.
- [ ] Mantener JWT/session callbacks de Next sin cambios innecesarios.
- [ ] Asegurar que RPC no distinga públicamente “email inexistente” y “password incorrecta”.
- [ ] Probar login válido, inválido, usuario borrado y backend temporalmente no disponible.
- [ ] Eliminar acceso de auth a DB desde `web`.

### Slice 7 — Meta OAuth

Separar responsabilidades:

`web` conserva:

- inicio del flujo desde el navegador;
- state/PKCE/cookies;
- callback de navegador;
- redirects y mensajes de UX.

`api` ejecuta:

- intercambio de authorization code usando Meta app secret;
- consulta de Pages autorizadas;
- cifrado/persistencia de user/Page tokens;
- subscribe/unsubscribe y validaciones de ownership/plan.

Acciones:

- [ ] El callback de Next valida state antes de llamar RPC.
- [ ] `redirectUri` se valida contra allowlist por ambiente.
- [ ] No guardar tokens en cookie/JWT ni retornarlos a componentes.
- [ ] Mover `META_APP_SECRET` y `TOKEN_ENCRYPTION_KEY` a `api`.
- [ ] Probar éxito, state inválido, code expirado, Page ya perteneciente a otro tenant y límite de plan.

### Slice 8 — Cutover de callbacks externos

#### Meta

1. Confirmar challenge del nuevo `GET https://api.resender.dev/webhooks/meta`.
2. Configurar callback nuevo en Meta.
3. Mantener temporalmente el handler antiguo como proxy fino al backend o compatibilidad de emergencia; no ejecutar ambas ingestiones en paralelo.
4. Enviar eventos controlados y confirmar:
   - firma;
   - persistencia única;
   - Queue;
   - firma al cliente;
   - logs/traces;
   - retries.
5. Observar por una ventana acordada.

#### Stripe

1. Crear endpoint de Stripe apuntando a `https://api.resender.dev/webhooks/stripe`.
2. Configurar su nuevo signing secret únicamente en `api`.
3. Suscribir solo los eventos requeridos.
4. Probar con Stripe CLI/sandbox.
5. Desactivar el endpoint antiguo solo después de verificar orden e idempotencia.

Acciones:

- [ ] No hacer doble side effect durante coexistencia.
- [ ] Los handlers antiguos pueden reenviar el `Request` crudo al binding temporalmente, pero no volver a implementar dominio.
- [ ] Documentar exactamente la hora/configuración del cutover.
- [ ] Confirmar Queue backlog y DLQ en cero/esperado.

### Slice 9 — API pública y documentación del producto

- [ ] Cambiar ejemplos de `https://resender.dev/api/meta/send` a `https://api.resender.dev/v1/messages`.
- [ ] Actualizar body: `pageId` UUID interno, `type`, `text` e `Idempotency-Key` obligatorio.
- [ ] Enlazar `/docs`, `/openapi.json` y `/openapi/download`.
- [ ] Actualizar documentación de webhooks con at-least-once, firma y deduplicación por event ID.
- [ ] Corregir cualquier texto que diga que no hay retries.
- [ ] Marcar endpoint legado como deprecated y anunciar ventana de retiro.
- [ ] Añadir guía de migración del endpoint legado a v1.

### Slice 10 — Transferencia de ownership y limpieza

Solo después de confirmar todos los slices:

- [ ] Mover migraciones y runner desde `apps/web` a `apps/api`.
- [ ] Cambiar CI/CD a: migraciones -> deploy `api` -> smoke -> deploy `web` -> smoke.
- [ ] Eliminar de `apps/web` todos los módulos que importan DB.
- [ ] Eliminar handlers antiguos de send, Meta webhook y Stripe webhook una vez vencida la compatibilidad.
- [ ] Eliminar adapters Meta/Stripe/crypto/api-key/billing de `web`.
- [ ] Eliminar dependencias npm que ya no usa `web`.
- [ ] Retirar de secretos/env de `web`:
  - `DATABASE_URL`
  - `TOKEN_ENCRYPTION_KEY`
  - `META_APP_SECRET`
  - `META_VERIFY_TOKEN`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - API key pepper/backend PostHog, si aplica
- [ ] Mantener en `web` únicamente secretos realmente presentacionales, especialmente `AUTH_SECRET`.
- [ ] Ejecutar `rg` para demostrar que `apps/web` no importa driver SQL ni usa los secretos retirados.
- [ ] Rotar secretos sensibles después de completar el traslado.

## Desarrollo local

El comando de aceptación continúa siendo:

```bash
npm run dev
```

Topología:

```text
localhost:3000  Next dev
       |
       | BACKEND service binding (registro local por nombre "api")
       v
localhost:8787  Wrangler dev / Worker api
       |
       | Queue local + DB de desarrollo
       v
consumers del mismo Worker
```

Puntos importantes:

- El binding resuelve por nombre de Worker, no porque el frontend haga `fetch("localhost:8787")`.
- `initOpenNextCloudflareForDev()` permite acceder a bindings durante `next dev`; usar la API vigente documentada por OpenNext/Next instalado.
- Levantar ambos procesos bajo Turbo.
- Si una carrera hace que `web` arranque antes de que `api` se registre, documentar/reintentar el arranque de forma acotada; no introducir fallback HTTP productivo.
- Mantener `.dev.vars` por app.
- Probar Queue local y una suite preview con OpenNext compilado.
- Para Meta: Tunnel/ngrok. Para Stripe: Stripe CLI.

## Observabilidad y SLOs del cutover

Logs separados por Worker:

- `web`: navegación, RSC/Actions, auth/UX, llamada RPC y error traducido.
- `api`: route/RPC/queue/scheduled, DB, proveedores, reglas y delivery.

Correlación:

- Propagar `requestId` desde `web` en el contexto RPC cuando el contrato lo permita.
- Conservar `eventId`, `messageId`, `deliveryId`, `stripeEventId` y Meta message ID.
- Nunca registrar secretos ni contenido sensible.

Dashboards mínimos:

- RPC rate, p50/p95/p99 y errores por método.
- HTTP v1 por ruta/status.
- Meta/Stripe callback success/failure.
- Queue backlog, retry rate, edad del mensaje más antiguo y DLQ.
- Delivery success rate y latencia.
- DB/provider error rate.

Gates sugeridos para continuar cada slice:

- sin regresión funcional en los tests;
- sin violaciones de tenant;
- error rate no mayor al baseline acordado;
- latencia dentro del presupuesto definido;
- sin crecimiento no explicado de Queue/DLQ.

## Estrategia de pruebas

### Contrato

- Snapshots de DTOs RPC y OpenAPI.
- Compatibilidad `api` nuevo con `web` anterior durante rollout.
- Compatibilidad `web` nuevo con `api` ya desplegado.

### Integración

- Next Server Component/Action -> binding -> API -> DB.
- NextAuth Credentials -> RPC.
- OAuth callback -> state Next -> exchange RPC.
- Billing action -> RPC -> Stripe fake/sandbox.
- Meta callback -> DB/outbox -> Queue -> webhook fake.
- Stripe callback -> DB/entitlement.

### Seguridad

- Tenant A no puede leer/mutar recursos de B ni manipulando IDs en browser.
- El browser no recibe bindings, API key, tokens o errores internos.
- `apps/web` funciona sin `DATABASE_URL`.
- Callbacks rechazan firmas inválidas.
- URLs de redirect/webhook respetan allowlists/SSRF policy.
- Logs no contienen secretos ni bodies sensibles.

### Regresión

- Registro/login/logout.
- Waitlist y gates.
- Pages connect/disconnect/reconnect.
- Conversations/messages.
- Crear/revocar key.
- Enviar por API v1 e idempotent replay.
- Checkout/portal/webhook.
- Account deletion.
- Local `npm run dev`, preview y producción.

## Cutover y rollback

### Regla de despliegue

Siempre:

```text
1. migraciones backward-compatible
2. api
3. smoke api/RPC
4. web
5. smoke end-to-end
```

Nunca desplegar primero un `web` que exige un método RPC todavía inexistente.

### Rollback por slice

- Revertir únicamente el consumidor de `web` al path anterior mientras ese path y sus secretos sigan disponibles.
- No revertir una migración aditiva.
- Si el problema está en `api`, desplegar la versión anterior compatible.
- Registrar duración máxima de fallback; no dejar dual ownership indefinido.

### Rollback de callbacks

- Meta/Stripe pueden volver temporalmente a la URL anterior solo mientras el handler anterior siga desplegado y probado.
- Pausar consumer si está dañando destinos; no purgar Queue/DLQ.
- Reprocesar jobs únicamente con idempotencia verificada.
- Evitar que ambas URLs procesen el mismo evento con side effects duplicados.

### Punto de no retorno

Eliminar rutas antiguas, secretos y DB de `web` solo después de:

- ventana estable acordada;
- callbacks nuevos confirmados;
- cero consumidores SQL;
- rollback alternativo mediante redeploy conocido;
- backup y runbook de migraciones.

## Criterios de aceptación finales

- [ ] `web` y `api` son Workers independientes con logs/traces independientes.
- [ ] Browser -> Next -> RPC funciona local, preview y producción.
- [ ] `apps/web` no importa `@neondatabase/serverless`, no abre DB y funciona sin `DATABASE_URL`.
- [ ] `apps/web` no posee secretos de Meta, Stripe, cifrado o API keys.
- [ ] `api` es el único dueño de migraciones y dominio.
- [ ] API pública y dashboard reutilizan los mismos casos de uso.
- [ ] No existen rutas HTTP internas protegidas por secreto.
- [ ] Meta y Stripe apuntan a `api.resender.dev`.
- [ ] Webhooks de clientes se entregan por Queue con firma, retries, DLQ e idempotencia.
- [ ] Documentación pública usa `/v1` y ofrece Swagger + JSON + descarga.
- [ ] Endpoint legado tiene plan de deprecación/retiro explícito.
- [ ] `npm run dev` levanta y conecta ambos Workers.
- [ ] Todos los tests y smokes están verdes.
- [ ] Rollback y DLQ replay están documentados y probados.
- [ ] Se rotaron los secretos trasladados.

## Definición de terminado

La separación no está terminada solo porque exista `apps/api`. Está terminada cuando:

1. El frontend opera exclusivamente por el Service Binding.
2. La API pública y los callbacks externos llegan al Worker `api`.
3. `web` ya no puede acceder a DB ni a secretos del backend.
4. La operación diaria permite investigar un request frontend en logs de `web` y continuar su traza en logs de `api`, Queue y delivery.

## Referencias vigentes

- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Cloudflare Service Bindings RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Cloudflare local development with multiple Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/)
- [Wrangler bindings per environment](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)
- [Wrangler `getPlatformProxy`](https://developers.cloudflare.com/workers/wrangler/api/)
- [OpenNext Cloudflare bindings](https://opennext.js.org/cloudflare/bindings)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Cloudflare Workers Traces](https://developers.cloudflare.com/workers/observability/traces/)
