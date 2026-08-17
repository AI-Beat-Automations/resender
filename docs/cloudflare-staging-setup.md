# Guía de infra — Entorno de staging para `apps/web`

> Contraparte del código en la rama `feat/cf-staging-env`.
> Todo lo de esta guía se hace en dashboards/CLI, no toca el repo.
> Continuación de [cloudflare-infra-checklist.md](./cloudflare-infra-checklist.md),
> que cubre el entorno de producción (ya en pie).

## Qué se está montando

Un segundo Worker, `web-staging`, con el mismo código que `web` y estado
propio: branch de Neon aparte, llaves de test de Stripe y app de Meta de
desarrollo. Se despliega solo desde la rama `staging`.

|              | producción                     | staging                                |
| ------------ | ------------------------------ | -------------------------------------- |
| Worker       | `web`                          | `web-staging`                          |
| Rama         | `main`                         | `staging`                              |
| Hostname     | `resender.dev`                 | `staging.resender.dev`                 |
| Workflow     | `.github/workflows/deploy.yml` | `.github/workflows/deploy-staging.yml` |
| Rate limiter | ns `1003`                      | ns `1004`                              |
| Stripe       | live                           | test                                   |
| App de Meta  | `Resender`                     | `Resender (Staging)`, misma portfolio  |

> **Orden importante:** los pasos 1–4 deben estar hechos **antes de mergear el
> PR**. El job `preview` de CI ahora sube versiones contra `web-staging`, así
> que va a fallar mientras ese Worker no exista.

---

## Paso 1 — Branch de Neon para staging

1. <https://console.neon.tech> → tu proyecto → **Branches** → **New branch**.
2. Nómbrala `staging`, con _parent_ = la branch productiva. Neon copia el
   esquema y los datos del momento, que sirve como fixture inicial.
3. Botón **Connect** sobre la branch `staging` y copia **dos** strings:
   - **Pooled** (el host contiene `-pooler`) → será el `DATABASE_URL` del
     Worker (paso 3).
   - **Direct** (sin `-pooler`) → será `DATABASE_URL_MIGRATIONS_STAGING` en
     GitHub (paso 4). Las migraciones DDL corren en Node y no deben pasar por
     PgBouncer.
4. Ambos con `?sslmode=require`.

> Verifica que el string pooled apunte a la branch `staging` y no a la
> productiva. Es el error más caro de esta guía: un deploy de staging correría
> migraciones contra la base real.

---

## Paso 2 — Primer deploy manual (crea el Worker)

El Worker tiene que existir antes de poder cargarle secretos.

```sh
cd apps/web
git checkout feat/cf-staging-env
npm install
CLOUDFLARE_ENV=staging npm run deploy
```

Va a fallar en runtime por falta de secretos — está bien, el objetivo es que
`web-staging` aparezca en el dashboard. Verifica en **Workers & Pages**.

---

## Paso 3 — Secretos del Worker de staging

Los secretos **no se heredan** entre ambientes: hay que cargar los once de
nuevo con `--env staging`. Cada comando pide el valor por stdin.

Usa `versions secret put` y no `secret put`. En `web-staging` el job `preview`
de CI sube una versión por cada push a cualquier PR, y esas versiones no se
promueven a deployment. Cuando la última versión no es la desplegada, wrangler
rechaza `secret put` con _"the latest version of your Worker isn't currently
deployed"_ — no es un error de configuración, es la protección contra promover
código sin querer al editar un secreto. `versions secret put` no toca el
tráfico: crea una versión nueva con el secreto y la deja sin desplegar.

```sh
cd apps/web

npx wrangler versions secret put DATABASE_URL --env staging          # string POOLED de la branch staging (paso 1)
npx wrangler versions secret put AUTH_SECRET --env staging           # openssl rand -base64 32 (uno NUEVO, no el de prod)
npx wrangler versions secret put TOKEN_ENCRYPTION_KEY --env staging  # openssl rand -hex 32 (uno NUEVO)
npx wrangler versions secret put APP_URL --env staging               # https://staging.resender.dev
npx wrangler versions secret put META_APP_SECRET --env staging       # app de Meta de staging
npx wrangler versions secret put META_VERIFY_TOKEN --env staging     # el que registres en el paso 7.1
npx wrangler versions secret put INSTAGRAM_APP_ID --env staging      # Instagram App ID (≠ app id de Meta), paso 7.2
npx wrangler versions secret put INSTAGRAM_APP_SECRET --env staging  # Instagram App Secret, firma el webhook de IG
npx wrangler versions secret put INSTAGRAM_VERIFY_TOKEN --env staging # el que registres en el paso 7.2
npx wrangler versions secret put STRIPE_SECRET_KEY --env staging     # sk_test_...
npx wrangler versions secret put STRIPE_WEBHOOK_SECRET --env staging # whsec_... del paso 8

# Promueve la versión que ya tiene los once secretos.
npx wrangler versions deploy --env staging
```

Verifica con `npx wrangler versions secret list --env staging` (deben salir los 11).

> `INSTAGRAM_APP_ID` va como secreto y no como variable pública: con Instagram
> Login el diálogo se arma en el servidor (`lib/instagram.ts`), a diferencia de
> Login for Business, donde el app id se inlinea en el bundle. Por eso no tiene
> par `NEXT_PUBLIC_*_STAGING` en el paso 4.

En producción sigue valiendo `wrangler secret put` a secas: nada sube versiones
sin desplegar contra `web`.

> **No reuses las llaves de producción.** Tres consecuencias, las tres
> deseadas:
>
> - `AUTH_SECRET` compartido haría que una sesión emitida en staging fuera
>   válida en producción.
> - `TOKEN_ENCRYPTION_KEY` nuevo deja ilegibles los page tokens que la branch de
>   Neon copió cifrados con la llave vieja. Hay que reconectar las páginas desde
>   la UI; un token productivo no debe ser descifrable desde staging.
> - Las API keys copiadas tampoco validan: `lib/api-keys/tokens.ts` usa
>   `API_KEY_PEPPER ?? AUTH_SECRET` y no hay pepper configurado, así que el hash
>   depende del `AUTH_SECRET`. Hay que generar keys nuevas en staging.

---

## Paso 4 — GitHub: secreto y variables de staging

Repo → **Settings** → **Secrets and variables** → **Actions**.

Pestaña **Secrets** → _New repository secret_:

| Nombre                            | Valor                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL_MIGRATIONS_STAGING` | string **directo** (sin pooler) de la branch `staging` (paso 1) |

`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` ya existen y se reusan.

Pestaña **Variables** → _New repository variable_. Estas se inlinean en el
bundle en build time, así que si faltan, el bundle de staging queda apuntando
a los servicios de producción o con valores vacíos:

| Nombre                               | Valor                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_META_APP_ID_STAGING`    | App ID de la app de Meta de desarrollo                                          |
| `NEXT_PUBLIC_META_CONFIG_ID_STAGING` | Config ID de esa misma app                                                      |
| `NEXT_PUBLIC_POSTHOG_KEY_STAGING`    | key de un proyecto PostHog aparte (no mezclar analítica de pruebas con la real) |
| `NEXT_PUBLIC_POSTHOG_HOST_STAGING`   | mismo host que producción                                                       |

---

## Paso 5 — Custom domain `staging.resender.dev`

1. Dashboard → **Workers & Pages** → `web-staging` → **Settings** →
   **Domains & Routes** → **Add** → **Custom domain**.
2. Escribe `staging.resender.dev`. Cloudflare crea el DNS y el certificado.
3. Verifica: `curl -I https://staging.resender.dev`.

---

## Paso 6 — Cloudflare Access sobre staging (no es opcional)

`staging.resender.dev` sirve el mismo HTML que `resender.dev`. Sin protección,
Google lo indexa como copia y parte la autoridad del dominio entre dos hosts —
exactamente lo que `workers_dev: false` y `preview_urls: false` ya evitan en
producción. Access lo resuelve de raíz: ningún crawler pasa del login.

1. Dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
   application** → **Self-hosted**.
2. _Application domain_: `staging.resender.dev`.
3. **Policy**: _Allow_ → _Emails_ → los correos del equipo (o _Emails ending in_
   `@ai-beat.co`).
4. Guarda y verifica en incógnito: debe pedir login de Access antes del sitio.

> Excepción: si vas a probar los webhooks de Meta o Stripe contra staging
> (pasos 7–8), esas rutas necesitan bypass. Agrega una policy previa de tipo
> **Bypass** con _Everyone_ para los paths `/api/meta/webhook`,
> `/api/meta/instagram/webhook` y `/api/stripe/webhook`; los tres validan firma
> HMAC por su cuenta.
>
> El de Instagram es fácil de olvidar y falla de forma confusa: Access responde
> un redirect al login antes de que la request llegue al Worker, así que Meta ve
> una verificación fallida al registrar el webhook y en `wrangler tail` no
> aparece absolutamente nada.

---

## Paso 7 — App de Meta de staging

Una app de Meta **hermana** de la productiva, no una _test app_ derivada de
ella. Las test apps viven siempre en modo desarrollo, no pueden pasar App
Review y por lo tanto nunca obtienen Advanced Access propio; además el producto
Instagram con Instagram Login necesita generar su propio Instagram App ID, que
una test app no expone. Compartir la app productiva tampoco es opción: el
callback del webhook es único por app y por producto, así que un mismo mensaje
entrante terminaría en las dos bases.

Créala dentro del **mismo Business Portfolio** que la de producción. La
verificación de negocio es del portfolio y no de la app, así que la de staging
la hereda sin volver a mandar documentación. Lo que no se hereda es el App
Review: staging se queda en modo desarrollo con Standard Access, y eso alcanza
porque solo se prueba con cuentas que tengan rol en la app (paso 7.4).

Ponle un nombre visiblemente distinto —`Resender (Staging)`—: es el que sale en
el diálogo de OAuth, y es lo que evita que alguien conecte una cuenta real al
entorno equivocado.

### 7.0 Crear la app

> Si `NEXT_PUBLIC_META_APP_ID` de `.env.staging` ya existe en _My Apps_, saltea
> este punto y sigue en 7.1.

Antes de empezar, abre la app de producción en otra pestaña: lo que se replica
es su configuración, y adivinarla cuesta más que copiarla. Anota el tipo de
app, los casos de uso activos, la categoría y los permisos de su configuración
de Login for Business.

1. <https://developers.facebook.com/apps/creation/>.
2. **Detalles de la app**: nombre `Resender (Staging)` y correo de contacto.
3. **Casos de uso**: los mismos que producción. Para este proyecto son dos —el
   de mensajería de páginas y **Administrar mensajes y contenido en Instagram**
   (_Manage messaging & content on Instagram_), que es el que habilita el
   producto Instagram con Instagram Login. Los incompatibles aparecen en gris.
4. **Portafolio comercial**: el **mismo verificado que producción**. Es el punto
   que hace que staging herede la verificación de negocio; conectarlo después
   es posible pero más engorroso.
5. **Requisitos** → **Resumen** → _Ir al panel_.
6. **Configuración** → **Básica**:
   - _Dominios de la app_: `staging.resender.dev`
   - _URL de la política de privacidad_: `https://resender.dev/privacy`
   - _URL de eliminación de datos_: `https://resender.dev/data-deletion`

   Las dos últimas apuntan a producción a propósito: staging queda detrás de
   Cloudflare Access (paso 6) y Meta no puede alcanzar una URL que le pide
   login.
7. Deja la app en **modo desarrollo**. No pidas App Review para staging: con
   Standard Access y cuentas con rol (7.4) alcanza, y un review de más es un
   trámite que hay que sostener en el tiempo.

### 7.1 Configuración de Login for Business

El `config_id` **pertenece a la app**: uno de producción usado con el
`client_id` de staging hace fallar el diálogo. Hay que crear uno propio.

1. App de staging → **Facebook Login for Business** → **Configuraciones** →
   _Crear configuración_.
2. Marca los mismos permisos que la configuración de producción. Los que el
   código necesita sí o sí: `pages_show_list` (`/me/accounts`),
   `pages_messaging` (envío) y `pages_manage_metadata` (`subscribed_apps`).
3. Copia el id resultante a `NEXT_PUBLIC_META_CONFIG_ID_STAGING` (paso 4).

### 7.2 Webhook de Messenger

1. App de staging → **Messenger** → **Webhooks** → _Edit Callback URL_.
2. **Callback URL**: `https://staging.resender.dev/api/meta/webhook`
3. **Verify token**: el valor exacto del `META_VERIFY_TOKEN --env staging`.
4. Suscribe **messages**, **messaging_postbacks** y
   **messaging_policy_enforcement** — los tres de
   `META_WEBHOOK_SUBSCRIBED_FIELDS` en `lib/meta.ts`.

### 7.3 Producto Instagram

Instagram trae credenciales propias dentro de la misma app, y su App Secret es
el que firma el webhook de IG. Confundirlo con `META_APP_SECRET` es el error de
configuración más común de esta integración; por eso son rutas y secretos
separados (ver el comentario de cabecera en `app/api/meta/instagram/webhook`).

1. App de staging → **Instagram** → _Configuración de la API con Instagram
   Login_.
2. Copia **Instagram App ID** e **Instagram App Secret** → `INSTAGRAM_APP_ID` e
   `INSTAGRAM_APP_SECRET` del paso 3.
3. **URI de redireccionamiento de OAuth válidas**:
   `https://staging.resender.dev/api/meta/instagram/callback`
4. **Webhooks** → **Callback URL**:
   `https://staging.resender.dev/api/meta/instagram/webhook`, con un verify
   token nuevo (`openssl rand -hex 16`) que va a `INSTAGRAM_VERIFY_TOKEN`.
5. Suscribe **messages** y **comments** — los de
   `INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS`. `message_echoes` no, a propósito.

### 7.4 Cuentas de prueba con rol en la app

En modo desarrollo solo funcionan las cuentas que tengan rol. Usa cuentas de QA
dedicadas, nunca las de un cliente: una cuenta de IG puede autorizar varias
apps a la vez, y el mismo DM llegaría a staging y a producción.

1. App de staging → **Roles de la app** → **Roles**.
2. Agrega la cuenta de Instagram de pruebas como _Instagram Tester_.
3. Acepta la invitación desde esa cuenta, en la app de Instagram →
   _Configuración_ → _Aplicaciones y sitios web_ → _Invitaciones de tester_.
4. Para Messenger, la página de pruebas tiene que ser administrada por un
   usuario con rol de admin, developer o tester en la app.

### 7.5 Usar la app de staging también en local

Mientras no exista una tercera app, local comparte la de staging. Dos cosas se
comportan distinto:

- **OAuth: convive sin problema.** Agrega la URL del túnel como segunda URI de
  redirección válida en 7.1 y 7.3. Cuál se usa lo decide `APP_URL`, y el mismo
  valor va al diálogo y al intercambio. Instagram Login exige HTTPS, así que
  `http://localhost:3000` no sirve para ese flujo: hace falta un túnel.
- **Webhook: no convive.** El callback es uno solo por producto. Apuntarlo al
  túnel deja a `staging.resender.dev` sin recibir eventos hasta que lo
  devuelvas. Usa un hostname de túnel fijo para que sea alternar entre dos
  valores guardados y no pegar una URL nueva cada vez.

---

## Paso 8 — Webhook de Stripe (modo test)

1. Dashboard de Stripe en **modo test** → **Developers** → **Webhooks** →
   **Add endpoint**.
2. **Endpoint URL**: `https://staging.resender.dev/api/stripe/webhook`
3. **Events**, los mismos cuatro que producción:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. **Reveal** el signing secret y cárgalo:
   ```sh
   npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
   ```

---

## Paso 9 — Crear la rama y validar el flujo

```sh
git checkout main
git pull
git checkout -b staging
git push -u origin staging
```

Eso dispara `deploy-staging.yml`. Revisa en Actions que corran migraciones y
deploy, y luego los smoke tests sobre `https://staging.resender.dev`:

- [ ] Login con un usuario de la branch de Neon de staging (valida scrypt).
- [ ] La landing carga y PostHog reporta al proyecto de staging, no al real.
- [ ] `stripe trigger checkout.session.completed --api-key sk_test_...` marca
      200 en el endpoint de test.
- [ ] Conectar una página desde la UI abre el diálogo sin error de
      configuración (valida que el `config_id` sea el de la app de staging y no
      el de producción).
- [ ] Mensaje real a la página de la app de staging → aparece en `/inbox`.
- [ ] DM y comentario a la cuenta de Instagram de pruebas → aparecen en
      `/inbox`. Si no llegan, `wrangler tail` distingue el caso: un
      `webhook_verify` con `verify_token_mismatch` es el token del panel, y un
      `webhook_receive` con `dropped` por firma es el App Secret cambiado.
- [ ] `npx wrangler tail --env staging` no muestra errores.

---

## Paso 10 — Cerrar el flujo en GitHub

El flujo es: **feature → `staging` → `main`**. Los workflows ya lo soportan,
pero sin esta configuración nada lo obliga y el entorno queda de decoración.

### 10.1 Base por defecto de los PRs

Repo → **Settings** → **General** → **Default branch** → cambia a `staging`.

Esto no cambia qué se despliega a producción (eso lo decide el trigger de
`deploy.yml`, que sigue apuntando a `main`). Lo que hace es que GitHub proponga
`staging` como base al abrir un PR, en vez de `main`. Sin esto, cada PR nuevo
apunta a `main` por defecto y hay que acordarse de corregirlo a mano.

El job `branch-flow` de `ci.yml` es la red de seguridad: falla cualquier PR a
`main` cuyo head no sea `staging`.

### 10.2 Reglas de rama

Repo → **Settings** → **Branches** → _Add rule_. Una regla para `main` y otra
para `staging`, ambas con:

- _Require a pull request before merging_
- _Require status checks to pass_ → marca `ci` y `preview`

En la de `main`, marca además `branch-flow`. Un check solo es obligatorio si
está en esta lista: si no, GitHub lo muestra rojo y deja mergear igual.

### 10.3 Método de merge para `staging` → `main`

Usa **"Create a merge commit"** en ese PR, no _Squash_ ni _Rebase_.

Squash crea un commit nuevo en `main` con hash distinto de los de `staging`.
Las ramas quedan divergidas para siempre y el próximo PR de `staging` a `main`
muestra como "nuevos" todos los cambios que ya están en producción. Con merge
commit los hashes se comparten y cada PR muestra solo lo que falta promover.

Puedes dejar squash habilitado para los PRs de feature → `staging`, donde sí
conviene (colapsa el ruido de "wip", "fix lint" en un commit legible).

---

## Flujo resultante

```text
feature branch
   │
   │ PR ──► ci.yml: lint, typecheck, test, build
   │        + sube una versión (sin promover) contra web-staging
   ▼
`staging` ──► deploy-staging.yml
              migraciones (Neon staging) → deploy a web-staging
              https://staging.resender.dev
   │
   │ PR (merge commit) ──► ci.yml + branch-flow
   ▼
`main` ──► deploy.yml
           migraciones (Neon prod) → deploy a web
           https://resender.dev
```

Cada migración corre dos veces: primero contra la branch de Neon de staging al
mergear a `staging`, y después contra la productiva al mergear a `main`. Por eso
importa que las migraciones sean idempotentes y que la branch de staging no
apunte por error a la base real.

## Pendiente para la fase 2

Cuando `apps/api` entre al frontend, `web-staging` necesita un service binding
`BACKEND` → `api-staging` (ver `docs/phase-2-api-migration-frontend.md`). El
bloque `env.staging` de `apps/web/wrangler.jsonc` es donde va, y como los
bindings no se heredan, hay que declararlo también ahí y no solo en el nivel
superior.
