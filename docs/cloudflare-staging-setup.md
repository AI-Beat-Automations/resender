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

Los secretos **no se heredan** entre ambientes: hay que cargar los ocho de
nuevo con `--env staging`. Cada comando pide el valor por stdin.

```sh
cd apps/web

npx wrangler secret put DATABASE_URL --env staging          # string POOLED de la branch staging (paso 1)
npx wrangler secret put AUTH_SECRET --env staging           # openssl rand -base64 32 (uno NUEVO, no el de prod)
npx wrangler secret put TOKEN_ENCRYPTION_KEY --env staging  # openssl rand -hex 32 (uno NUEVO)
npx wrangler secret put META_APP_SECRET --env staging       # app de Meta de desarrollo
npx wrangler secret put META_VERIFY_TOKEN --env staging     # el que registres en el paso 7
npx wrangler secret put STRIPE_SECRET_KEY --env staging     # sk_test_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging # whsec_... del paso 8
npx wrangler secret put APP_URL --env staging               # https://staging.resender.dev
```

Verifica con `npx wrangler secret list --env staging` (deben salir los 8).

> **No reuses las llaves de producción.** `AUTH_SECRET` compartido significa
> que una sesión emitida en staging es válida en producción. `TOKEN_ENCRYPTION_KEY`
> nuevo es correcto acá: la branch de Neon copió page tokens cifrados con la
> llave vieja, así que las conexiones de Meta en staging quedan ilegibles y hay
> que reconectarlas — que es justo lo que quieres, tokens productivos no deben
> ser descifrables desde staging.

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
> **Bypass** con _Everyone_ para los paths `/api/meta/webhook` y
> `/api/stripe/webhook`; ambos ya validan firma HMAC por su cuenta.

---

## Paso 7 — Webhook de Meta (app de desarrollo)

Usa una app de Meta distinta de la productiva; compartirla haría que un mismo
mensaje entrante llegue a las dos bases.

1. <https://developers.facebook.com> → app de desarrollo → **Messenger** →
   **Webhooks** → _Edit Callback URL_.
2. **Callback URL**: `https://staging.resender.dev/api/meta/webhook`
3. **Verify token**: el valor exacto del `META_VERIFY_TOKEN --env staging`.
4. Suscribe los campos **messages** y **messaging_postbacks**.

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
- [ ] Mensaje real a la página de la app de desarrollo → aparece en `/messages`.
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
