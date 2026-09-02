> **Obsoleto — [ADR 0012](./adr/0012-un-solo-worker-next-sin-api-separada.md).**
> Describe el Worker `api`, que se borró del repo y de la cuenta de Cloudflare.
> Las colas que crea (`webhook-deliveries*`) siguen en uso, pero ahora las
> produce y consume el Worker `web`. Se conserva por los comandos de creación de
> recursos, que siguen siendo los correctos.

# API Worker: manual Cloudflare runbook

Status: phase 1 implementation only. None of the commands in this runbook were
executed against a Cloudflare account while implementing the branch.

The existing `web` Worker remains the production frontend, database owner, and
live receiver for Meta and Stripe callbacks. Do not change provider callback
URLs until phase 2 has been reviewed and deployed.

## Preconditions

1. Review `apps/api/wrangler.jsonc` and confirm that Rate Limiting
   `namespace_id` values `1001` (production) and `1002` (staging) are positive
   integers unique within the Cloudflare account. Replace them if either is
   already assigned.
2. Create a separate Neon branch/database for staging and local testing.
3. Apply `apps/web/db/migrations/0010_api_worker_outbox.sql` through the
   existing `web` migration pipeline. There is intentionally no second
   migration owner.
4. Confirm the Queue names in the config are unused or intentionally reused.
5. Confirm the Cloudflare account is on a plan that supports Queues and the
   Rate Limiting binding.

## Initialize webhook signing secrets before cutover

Migration `0010` keeps `connected_pages.webhook_signing_secret_encrypted`
nullable because the legacy web application still writes Page rows. The API
Worker deliberately reports `GET /readyz` as `503` while any active Page has a
customer webhook URL but no signing secret.

Before staging or production traffic moves to the API Worker:

1. Identify affected Pages with a read-only query:

   ```sql
   select id, tenant_id, meta_page_id
   from connected_pages
   where status = 'active'
     and webhook_url is not null
     and webhook_signing_secret_encrypted is null
   order by tenant_id, id;
   ```

2. For every row, call
   `POST /v1/pages/{pageId}/webhook-secret/rotate` as that tenant and deliver
   the returned one-time `whsec_...` value to the webhook owner through the
   approved secret channel.
3. Do not write plaintext or an invented encrypted value directly to the
   database. Rotation uses the configured encryption key and records its time.
4. Repeat the read-only query until it returns no rows, then confirm
   `GET /readyz` returns `200`.

The API also refuses to enable a webhook URL on a Page without a signing
secret. Rotate first, store the one-time value at the receiver, then set the
URL. Existing Pages without a customer URL do not block readiness.

## Create resources

Authenticate manually, then run these from the repository root:

```bash
npx wrangler queues create webhook-deliveries
npx wrangler queues create webhook-deliveries-dlq
npx wrangler queues create webhook-deliveries-staging
npx wrangler queues create webhook-deliveries-staging-dlq
```

Do not add invented Queue IDs to `wrangler.jsonc`; Queue bindings use the exact
names above.

## Configure secrets

Set every secret separately for staging and production. Never paste values into
`wrangler.jsonc`, `.dev.vars.example`, CI logs, or tickets.

```bash
cd apps/api
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET
npx wrangler secret put API_KEY_PEPPER
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Repeat with `--env staging`. `TOKEN_ENCRYPTION_KEY` must be compatible with the
value used by `web` or existing tokens cannot be read. Use a direct Neon URL for
schema migrations and the approved runtime URL for the Worker.

### Baja de `AUTH_SECRET` y `API_KEY_PEPPER` (ADR 0014, escalón 3)

Los dos secretos de arriba **ya no los lee nadie**. `AUTH_SECRET` firmaba la
sesión de Auth.js —reemplazada por `BETTER_AUTH_SECRET` en el escalón 2— y hacía
además de pepper de las API keys propias; `API_KEY_PEPPER` era ese mismo pepper,
explícito. Desde el escalón 3 las API keys las emite, hashea y verifica el plugin
`apiKey` de Better Auth, con SHA-256 **sin pepper**, y `lib/api-keys/*` no
existe. Ningún camino del Worker `web` los referencia.

**El borrado se hace a mano y va último**, sobre el Worker `web` (el `api` ya no
existe). El orden no es negociable: borrarlos antes de reemitir y verificar deja
las integraciones caídas sin señal de por qué.

1. Desplegar (`db:migrate` aplica la `0022` y la `0023` en el mismo paso).
2. Reemitir las API keys desde `Settings → API keys` y pegarlas en N8N.
3. Verificar los cinco caminos: los `send` de Messenger, Instagram y WhatsApp,
   la descarga de media de WhatsApp y la respuesta a comentarios.
4. Recién entonces:

```bash
cd apps/web
npx wrangler secret delete AUTH_SECRET
npx wrangler secret delete API_KEY_PEPPER
npx wrangler secret delete AUTH_SECRET --env staging
npx wrangler secret delete API_KEY_PEPPER --env staging
```

5. Volver a verificar los cinco caminos. Es la comprobación de que no quedó
   ningún consumidor del pepper viejo.

Sacarlos también de `.dev.vars` local, si estaban.

## Validate before deployment

```bash
npm --workspace @workspace/contracts run typecheck
npm --workspace api run cf-typegen:check
npm --workspace api run lint
npm --workspace api run typecheck
npm --workspace api run test:run
npm --workspace api run build
```

The `build` script is a Wrangler dry run. It does not deploy.

## Deploy without moving traffic

After the resources and secrets exist:

```bash
npm --workspace api run deploy:staging
```

Smoke-test staging:

- `GET /healthz` returns `200`.
- `GET /readyz` returns `200` without exposing dependency details.
- `/openapi.json` and `/openapi/download` contain the same document.
- An absent, malformed, and revoked API key each fail without exposing tenant
  data.
- A controlled Meta/Stripe test signature is accepted; an altered raw body is
  rejected.
- A test inbound event produces one job and a duplicate does not produce a
  second message.
- Delivery outcomes cover 2xx, 408, 429, permanent 4xx, 5xx, timeout, retry,
  and DLQ.

Only after staging evidence is approved:

```bash
npm --workspace api run deploy
```

Creating or deploying the Worker is not authorization to change DNS, the Meta
callback, the Stripe webhook endpoint, or the `web` Worker service bindings.
Those cutovers belong to phase 2.

## Security and architecture notes

- Delivery validates HTTPS/default port/hostname and resolves DNS immediately
  before every request. Workers `fetch` cannot be pinned to the address that
  was checked, so a narrow DNS-rebinding time-of-check/time-of-use risk remains.
  Keep outbound monitoring and consider an egress proxy if the threat model
  later requires address pinning.
- Redirects are always manual, so a customer endpoint cannot redirect the
  Worker into a private network.
- Hyperdrive is deliberately excluded by the approved phase-1 scope. Neon HTTP
  plus Smart Placement is the documented exception; reassess Hyperdrive as a
  separate migration.
- Queue delivery is at least once. Consumers must deduplicate with
  `Resender-Event-Id`.
- Alert on API 5xx, callback signature failures, Queue backlog, DLQ messages,
  provider latency, and webhook delivery failure rate. Logs must never include
  Authorization, cookies, signatures, tokens, passwords, message text, or raw
  provider bodies.

## Rollback

Provider traffic still points at `web`, so rollback is limited:

1. Stop test traffic to `api`.
2. Roll back the `api` Worker version in Cloudflare.
3. Leave migration `0010` in place; it is additive and compatible with legacy
   `web` inserts.
4. Do not purge the Queue or DLQ. Inspect and reconcile jobs using the DLQ
   runbook.

The source files `docs/domain.md` and `prd_api_separation.md` referenced by the
planning document were absent. `CONTEXT.md`, migrations `0001`–`0009`, current
production code, and `docs/phase-1-api-migration.md` were used as the canonical
inputs.

---

# Infraestructura manual de WhatsApp (Fase 1)

> Vigente. A diferencia del resto de este documento, esta sección **no** describe
> el Worker `api` borrado por la [ADR 0012](./adr/0012-un-solo-worker-next-sin-api-separada.md):
> los recursos son del Worker `web`, que es el único desplegado, y los bindings
> ya están declarados en `apps/web/wrangler.jsonc`.

Nada de esto lo crea el deploy. `wrangler deploy` **falla** si el bucket o la
cola que nombra un binding no existen todavía, así que estos comandos se corren
a mano —una sola vez, autenticado contra la cuenta de Cloudflare— **antes** del
primer deploy con el canal de WhatsApp.

## Crear buckets R2 y colas

Desde la raíz del repositorio:

```bash
npx wrangler r2 bucket create whatsapp-media
npx wrangler r2 bucket create whatsapp-media-staging
npx wrangler r2 bucket lifecycle add whatsapp-media --prefix wa/ --expire-days 180
npx wrangler r2 bucket lifecycle add whatsapp-media-staging --prefix wa/ --expire-days 180
npx wrangler queues create whatsapp-jobs
npx wrangler queues create whatsapp-jobs-dlq
npx wrangler queues create whatsapp-jobs-staging
npx wrangler queues create whatsapp-jobs-staging-dlq
```

Los nombres son exactos: los bindings de `apps/web/wrangler.jsonc`
(`WHATSAPP_MEDIA`, `WHATSAPP_JOBS`) resuelven por nombre, no por id.

Comprobaciones después de correrlos:

- `npx wrangler r2 bucket list` muestra los dos buckets.
- `npx wrangler r2 bucket lifecycle list whatsapp-media` muestra la regla de 180
  días sobre el prefijo `wa/`.
- `npx wrangler queues list` muestra las cuatro colas.
- Ninguno de los dos buckets tiene acceso público ni el subdominio `r2.dev`
  habilitado. Lo que autoriza una descarga es la fila de `messages` en Postgres,
  no el bucket; con `r2.dev` prendido, una key filtrada sería acceso anónimo al
  archivo de un cliente.

**La lifecycle rule es la retención.** Los 180 días de media entrante no son
código: no hay job de borrado por antigüedad, y el estado que ve la UI se deriva
de la edad de la fila. Si la regla no se crea, los bytes se acumulan para
siempre y el costo de R2 no queda acotado por nada —la cuota del plan mide
eventos, no bytes—. Es también la red de seguridad del borrado de cuenta: aunque
el job `media_purge` muera para siempre, los archivos expiran solos.

## Por qué staging tiene bucket y colas propios

Porque compartirlos sería darle a un job de prueba acceso a los archivos de un
cliente que paga.

No es una precaución teórica: el job `media_purge` borra **por prefijo**
(`wa/{tenantId}/`) y el consumidor de `whatsapp-jobs` toma los mensajes de la
cola sin preguntar quién los puso. Con un bucket compartido, un tenant de prueba
que reusara un uuid, un fixture mal armado o un purge lanzado contra la base
equivocada borrarían media real de producción, y no hay papelera: R2 no
versiona estos objetos y la copia de Meta ya expiró (la URL de descarga dura 5
minutos). Con la cola compartida el problema es simétrico: un import de
historial de staging son miles de jobs que el consumidor de producción tomaría
como propios.

Mismo criterio, ya escrito, para las colas de `webhook-deliveries` y para el
`namespace_id` del rate limiter en `apps/web/wrangler.jsonc`.

## Secretos y vars nuevas

Producción, desde `apps/web`:

```bash
cd apps/web
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
```

`WHATSAPP_VERIFY_TOKEN` es **propio de este webhook** y no se reusa
`META_VERIFY_TOKEN`: el challenge de WhatsApp llega a
`/api/meta/whatsapp/webhook`, y compartir el valor haría que rotarlo por un
incidente en un canal obligara a reconfigurar el otro en el App Dashboard. Es
una cadena aleatoria larga, distinta por ambiente, y no vive en el repositorio.

Staging **no** usa `wrangler secret put`. CI sube una versión de `web-staging`
por cada PR sin desplegarla (`.github/workflows/ci.yml`, job `preview`), y en
ese estado wrangler rechaza `secret put` con «the latest version of your Worker
isn't currently deployed». La forma que no toca el tráfico:

```bash
npx wrangler versions secret put WHATSAPP_VERIFY_TOKEN --env staging
```

`META_APP_ID`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` y `DATABASE_URL` se
reusan tal cual están: la firma del webhook de WhatsApp es el mismo
`X-Hub-Signature-256` con el mismo App Secret, y el PIN cifrado de
`connected_pages` usa la misma `TOKEN_ENCRYPTION_KEY` que los tokens de página.

### Var de runtime

`META_GRAPH_VERSION` es una **var**, no un secreto: no es sensible y conviene
poder leerla en el dashboard para saber contra qué versión de Graph está
corriendo cada ambiente. Va en el bloque `vars` de `apps/web/wrangler.jsonc`
—producción y `env.staging`, porque `vars` no se hereda— y la aplicación la
valida al arrancar en vez de hardcodear la versión en cada llamada.

### Variables de build en GitHub Actions

`NEXT_PUBLIC_WHATSAPP_CONFIG_ID` es el Configuration ID del Embedded Signup y
**no** es un secreto de Worker: las `NEXT_PUBLIC_*` se inlinean en el bundle
durante `next build`, así que cargarlas con `wrangler secret put` no tendría
ningún efecto. Se configuran como *variables* del repositorio en GitHub
(Settings → Secrets and variables → Actions → Variables), que es de donde ya las
leen los dos workflows:

| Variable de GitHub | La consume | Se inyecta como |
|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` | `.github/workflows/deploy.yml` | `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` |
| `NEXT_PUBLIC_WHATSAPP_CONFIG_ID_STAGING` | `.github/workflows/deploy-staging.yml` | `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` |

El gemelo de staging existe por lo mismo que el de `NEXT_PUBLIC_META_CONFIG_ID`:
si en el build de staging se cuela el valor de producción, el bundle de staging
abre el Embedded Signup de la app de Meta productiva y un onboarding de prueba
termina conectando un número contra la app real.

## Configuración en el App Dashboard de Meta

Fuera de Cloudflare, pero parte del mismo paso manual y sin lo cual nada de lo
anterior sirve:

1. Producto WhatsApp agregado a la app de Meta, con la URL de callback
   `https://resender.dev/api/meta/whatsapp/webhook` y el mismo
   `WHATSAPP_VERIFY_TOKEN` que se cargó en el Worker (staging apunta a
   `https://staging.resender.dev/...` con su propio valor).
2. Suscripción por WABA a los cuatro campos: `messages`, `history`,
   `smb_app_state_sync` y `smb_message_echoes`. Los tres últimos son requisito
   de Coexistence y hay que suscribirlos **antes** de onboardear un número, no
   después.
3. Embedded Signup configurado con **session logging habilitado** —es requisito
   de Meta para Coexistence, no una opción— y su Configuration ID copiado a las
   variables de GitHub de la tabla anterior.

## Verificación de extremo a extremo

Antes de dar el canal por operativo:

- `GET /api/meta/whatsapp/webhook` con el challenge de Meta devuelve el
  `hub.challenge`; con un verify token equivocado devuelve `403`.
- Un mensaje con imagen al número de prueba deja el adjunto en `available` y el
  objeto bajo `wa/{tenantId}/...` en el bucket del ambiente correcto.
- `npx wrangler queues list` muestra consumo en `whatsapp-jobs` y nada en
  `whatsapp-jobs-dlq`.
- Borrar una cuenta de prueba deja el prefijo `wa/{tenantId}/` vacío, o un job
  reclamable a la vista.

---

# Google como proveedor social (issue #98)

> Vigente. Recursos del Worker `web`, igual que la sección de WhatsApp. Nada de
> esto lo crea el deploy: sin `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` el
> botón "Continuar con Google" simplemente no se dibuja, así que un deploy sin
> estos pasos no rompe nada — pero tampoco habilita Google.

## Secretos

Producción, desde `apps/web`:

```bash
cd apps/web
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Staging, por la misma razón que `WHATSAPP_VERIFY_TOKEN` (CI sube versiones de
`web-staging` sin desplegarlas y `secret put` las rechaza):

```bash
npx wrangler versions secret put GOOGLE_CLIENT_ID --env staging
npx wrangler versions secret put GOOGLE_CLIENT_SECRET --env staging
```

Local: las mismas dos variables en `apps/web/.env`.

**Contra aceptado y documentado.** Hay **un solo** cliente OAuth de Google para
los tres entornos (ver abajo), así que el secreto de producción de Google vive
también en el `.env` local de cada máquina de desarrollo. La alternativa
higiénica —dos clientes, producción separada de no-producción, para que el
secreto productivo no baje nunca al disco— quedó descartada en el issue #98 a
favor de la simplicidad de creación y rotación. Si se rota, se rota en los tres
lugares a la vez.

## Vars de runtime

`RESEND_TEMPLATE_VERIFY_EMAIL` y `RESEND_TEMPLATE_ACCOUNT_LINKED` son IDs de
plantilla de Resend: **vars**, no secretos, exactamente como
`RESEND_TEMPLATE_PASSWORD_RESET`. Van en el bloque `vars` de
`apps/web/wrangler.jsonc` —producción **y** `env.staging`, porque `vars` no se
hereda— y en `apps/web/.env` para local.

## Cliente OAuth en la consola de Google

Un único cliente OAuth (tipo *Web application*) con **tres** `redirect_uri`:

```
https://resender.dev/api/auth/callback/google
https://staging.resender.dev/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

Better Auth arma el `redirect_uri` desde `BETTER_AUTH_URL`, **no** desde
`APP_URL`: `APP_URL` es el túnel de ngrok y es de Meta. Si Google devuelve
`redirect_uri_mismatch`, lo primero a comparar es `BETTER_AUTH_URL` del entorno
contra esta lista.

La app hay que **publicarla a Production** en la pantalla de consentimiento
(OAuth consent screen → *Publish app*). En *Testing* hay un tope de 100 usuarios
y cada uno tiene que estar cargado a mano en una lista. No requiere revisión de
Google: los únicos scopes que se piden son `openid`, `email` y `profile`, y los
tres son no sensibles.

## Plantillas en Resend

Crear dos plantillas nuevas en el editor de Resend pegando el HTML versionado en
el repositorio, y copiar el ID de cada una a las vars de arriba:

| Plantilla | HTML | Var |
|---|---|---|
| Confirmación de correo | `docs/email/verify-email.html` | `RESEND_TEMPLATE_VERIFY_EMAIL` |
| Aviso de vinculación | `docs/email/account-linked.html` | `RESEND_TEMPLATE_ACCOUNT_LINKED` |

Las palabras no viven en la plantilla sino en el diccionario del repositorio y
llegan como variables (mismo molde que `password-reset`). Antes de dar por buena
cada plantilla: mandar un correo de prueba a `info@resender.dev` **en cada
idioma** y comprobar que todas las variables se rellenaron.

## Orden de verificación al desplegar

**Todas las cuentas que existen hoy tienen `email_verified = false`**, incluidas
las propias, y Google **no le funciona a nadie** hasta que confirme su correo:
la librería se niega a vincular un proveedor social a una cuenta local sin
verificar. No es un bug, es el candado haciendo su trabajo, y conviene probarlo
en este orden:

1. Con la cuenta propia, entrar con contraseña y abrir **Settings**. Las cuentas
   aprobadas **no llegan a `/pending`** (las rebota a `/connections`), así que
   el reenvío de confirmación que necesitan está en el panel "Cómo entrás a
   Resender" de Settings, no en la pantalla de espera.
2. Antes de confirmar, probar "Continuar con Google" desde `/login` con ese
   mismo correo: tiene que rebotar con *account_not_linked* y ofrecer reenviar
   la confirmación. Es la prueba manual del candado.
3. Reenviar la confirmación desde Settings, abrir el enlace del correo,
   comprobar que aterriza en `/connections` y que Settings ya no muestra
   "Correo sin confirmar".
4. Vincular Google desde Settings (o volver a probar el botón de `/login`):
   tiene que llegar el aviso de vinculación al buzón y la contraseña tiene que
   seguir sirviendo.
5. Con un correo nuevo, probar el alta por Google de punta a punta: la cuenta
   nace confirmada, sin correo de confirmación, y aterriza en `/pending`.
