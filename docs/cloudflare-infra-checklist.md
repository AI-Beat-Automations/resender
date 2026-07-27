# Guía de infra paso a paso — Migración a Cloudflare Workers

> Contraparte del trabajo de código en la rama `feat/cloudflare-opennext`.
> Todo lo de esta guía se hace en dashboards/CLI, no toca el repo.
>
> **Orden recomendado:** los pasos 1–4 se pueden hacer en cualquier momento.
> El paso 6 (primer deploy) necesita 1, 3 y 5. El custom domain (6.3) necesita
> que la zona DNS esté activa (paso 2, puede tardar horas). Meta y Stripe
> (pasos 8–9) van al final, cuando el dominio ya responde.

---

## Paso 0 — Prerrequisitos locales

```sh
cd ~/git/resender
git checkout feat/cloudflare-opennext
npm install          # asegura wrangler y @opennextjs/cloudflare instalados
npx wrangler --version   # debe imprimir 4.x
```

---

## Paso 1 — Cuenta de Cloudflare + plan Workers Paid

1. Entra a <https://dash.cloudflare.com> (crea la cuenta si no existe).
2. Menú lateral → **Workers & Pages** → pestaña **Plans**.
3. Compra **Workers Paid** ($5/mes). Incluye 10M requests/mes; estimamos ~100k, sobra.
4. Anota tu **Account ID**: aparece en la barra lateral derecha de la página
   *Workers & Pages → Overview* (también en la URL del dashboard:
   `dash.cloudflare.com/<account-id>`). Lo usarás en los pasos 6 y 7.

### 1.1 Crear el API Token (para CI/CD y deploys sin browser)

1. Arriba a la derecha → icono de perfil → **My Profile** → **API Tokens**.
2. **Create Token** → usa el template **Edit Cloudflare Workers** → *Use template*.
3. En *Account Resources* selecciona tu cuenta; en *Zone Resources* selecciona
   *All zones from an account* (hace falta para asignar el custom domain).
4. **Continue to summary** → **Create Token**.
5. Copia el token **ahora** (no se vuelve a mostrar). Guárdalo en tu password
   manager; lo usarás como `CLOUDFLARE_API_TOKEN` en el paso 7.

---

## Paso 2 — Dominio: `resender.dev` a Cloudflare (nameservers, sin transferir)

1. Dashboard de Cloudflare → **Add a domain** (o botón *+ Add site*).
2. Escribe `resender.dev` → selecciona el plan **Free** de zona → *Continue*.
3. Cloudflare escanea DNS existente; revisa que los registros que quieras
   conservar estén (si el dominio no servía nada, puede quedar vacío).
4. Cloudflare te muestra **2 nameservers** (algo como `xxx.ns.cloudflare.com` y
   `yyy.ns.cloudflare.com`). Cópialos.
5. En **Hostinger**: hPanel → **Dominios** → `resender.dev` → **DNS / Nameservers**
   → *Cambiar nameservers* → opción *Usar nameservers personalizados* → pega los
   2 de Cloudflare → guardar.
6. Espera la propagación (minutos a ~24h). Verifica con:

   ```sh
   dig NS resender.dev +short
   # debe devolver los dos *.ns.cloudflare.com
   ```

7. En Cloudflare la zona pasará de *Pending* a **Active** (te llega email).
   **No sigas con el paso 6.3 (custom domain) hasta ver Active.**

---

## Paso 3 — Neon: los dos connection strings

1. Entra a <https://console.neon.tech> → tu proyecto.
2. Botón **Connect** (o *Connection Details* en el dashboard del branch).
3. Copia **dos** strings del mismo branch/database/rol:
   - **Pooled connection** (interruptor *Connection pooling* activado — el host
     contiene `-pooler`, ej. `ep-xxx-pooler.us-east-2.aws.neon.tech`).
     → Este es el `DATABASE_URL` del **Worker** (paso 5).
   - **Direct connection** (pooling desactivado, host sin `-pooler`).
     → Este es `DATABASE_URL_MIGRATIONS` en **GitHub** (paso 7); las migraciones
     DDL corren en Node durante el deploy y no deben pasar por PgBouncer.
4. Ambos deben incluir `?sslmode=require`.

---

## Paso 4 — Rotación de llaves (recomendada, no urgente)

El `.env` **nunca estuvo en el historial de git** (verificado con `git log --all`),
así que no hay fuga confirmada. Aun así, al pasar a producción es buen momento
para rotar. Genera los nuevos valores así:

```sh
openssl rand -base64 32   # → AUTH_SECRET nuevo
openssl rand -hex 32      # → TOKEN_ENCRYPTION_KEY nuevo (64 hex = 32 bytes)
```

- **Stripe secret key**: Dashboard → Developers → API keys → *Roll key*.
- **Meta app secret**: developers.facebook.com → tu app → App settings → Basic
  → App secret → *Reset*.
- **Password de Neon**: Console → Roles → reset password (regenera los dos
  strings del paso 3).

> ⚠️ **Ojo con `TOKEN_ENCRYPTION_KEY`**: rotarla invalida los page tokens de
> Meta cifrados en `connected_pages`. Después de rotarla hay que **reconectar
> las páginas** desde la UI de Resender. Si no quieres ese trabajo ahora,
> conserva la actual (no estuvo expuesta en git).

---

## Paso 5 — Secretos del Worker

Cada comando te pedirá el valor por stdin (no queda en el history del shell).
Corre todo desde `apps/web/`:

```sh
cd apps/web
npx wrangler login    # abre el browser; autoriza wrangler en tu cuenta

npx wrangler secret put DATABASE_URL            # string POOLED de Neon (paso 3)
npx wrangler secret put AUTH_SECRET             # paso 4
npx wrangler secret put TOKEN_ENCRYPTION_KEY    # 64 hex (32 bytes)
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN       # el que registrarás en Meta (paso 8)
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # whsec_... (lo obtienes en el paso 9; puedes ponerlo después)
npx wrangler secret put APP_URL                 # https://resender.dev
```

Nota: la primera vez que corras `wrangler secret put` sin que el Worker exista,
wrangler pregunta si quieres crearlo — di que sí (lo crea como `web`,
el `name` de `wrangler.jsonc`). Verifica con `npx wrangler secret list`.

### 5.1 Preview local (opcional)

Para `npm run preview -w web` (corre el Worker real en tu máquina), crea
`apps/web/.dev.vars` (ya está en `.gitignore`) con las mismas claves en formato
`CLAVE=valor`, una por línea. Puedes usar la base de dev y llaves de test de Stripe.

---

## Paso 6 — Primer deploy manual

### 6.1 Deploy

```sh
cd apps/web
npm run deploy    # = opennextjs-cloudflare build && deploy
```

Al final imprime la URL del Worker: `https://web.resender.workers.dev`.

### 6.2 Smoke test en workers.dev

Abre esa URL: debe cargar la landing. Prueba login (valida scrypt en el Worker).
Si algo truena, `npx wrangler tail` muestra los logs en vivo.

### 6.3 Custom domain (requiere zona Active del paso 2)

1. Dashboard → **Workers & Pages** → `web` → **Settings** →
   **Domains & Routes** → **Add** → **Custom domain**.
2. Escribe `resender.dev` → Cloudflare crea el DNS y el certificado solo.
3. (Opcional) repite con `www.resender.dev` si lo quieres.
4. Verifica: `curl -I https://resender.dev` → debe responder el Worker (200/3xx).

---

## Paso 7 — GitHub (el CI/CD ya está en `.github/workflows/`)

Repo en GitHub → **Settings** → **Secrets and variables** → **Actions**:

Pestaña **Secrets** → *New repository secret*:

| Nombre | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token del paso 1.1 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID del paso 1 |
| `DATABASE_URL_MIGRATIONS` | string **directo** (sin pooler) del paso 3 |

Pestaña **Variables** → *New repository variable*:

| Nombre | Valor |
|---|---|
| `NEXT_PUBLIC_META_APP_ID` | el App ID de Meta (mismo del `.env`) |
| `NEXT_PUBLIC_META_CONFIG_ID` | el Config ID de Meta (mismo del `.env`) |

Flujo resultante: cada PR corre `lint → typecheck → test → build` y sube una
versión de **preview** del Worker (la URL sale en el log del job `preview`);
cada merge a `main` corre migraciones contra Neon y deploya a producción.

---

## Paso 8 — Webhook de Meta

1. <https://developers.facebook.com> → tu app → producto **Messenger** →
   **Settings** (o *Webhooks* en el menú del producto).
2. En **Webhooks** → *Edit Callback URL*:
   - **Callback URL**: `https://resender.dev/api/meta/webhook`
   - **Verify token**: exactamente el valor que pusiste en
     `wrangler secret put META_VERIFY_TOKEN` (paso 5).
3. *Verify and save* — Meta hace un GET de challenge; si el secreto coincide,
   queda verificado al instante.
4. Confirma que las suscripciones de página incluyen los campos **messages** y
   **messaging_postbacks**.
5. Prueba: mándale un mensaje a la página conectada → debe aparecer en
   `/messages` del dashboard y generar una fila en `external_webhook_deliveries`.

---

## Paso 9 — Webhook de Stripe

1. Dashboard de Stripe → **Developers** → **Webhooks** → **Add endpoint**
   (modo **live**; repite en test si lo usas).
2. **Endpoint URL**: `https://resender.dev/api/stripe/webhook`
3. **Events**: selecciona exactamente estos 4:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Crea el endpoint → en su página, **Reveal** el *Signing secret* (`whsec_...`).
5. Cárgalo al Worker:

   ```sh
   cd apps/web
   npx wrangler secret put STRIPE_WEBHOOK_SECRET   # pega el whsec_...
   ```

6. Valida end-to-end con Stripe CLI:

   ```sh
   stripe trigger checkout.session.completed
   # y revisa en Dashboard → Webhooks → tu endpoint → que el evento marque 200
   ```

   (O desde el dashboard: el endpoint → *Send test event*.)

7. Si el endpoint viejo (Vercel/ngrok/lo que hubiera) sigue existiendo,
   **elimínalo** para no procesar eventos doble.

---

## Paso 9.1 — Customer Portal: diferir los cambios de plan

> Requerido por el ADR 0003 (entitlements por plan). **Sin esto la regla de
> downgrade diferido no se sostiene aunque el código esté bien.**

Por defecto Stripe aplica los cambios de plan **inmediato y con prorrateo**.
Con los límites por plan activos eso significa que un cliente que baja de Pro a
Starter con 5 páginas conectadas queda **bloqueado por exceso de páginas el
mismo día que baja**, en vez de al cierre del período que ya pagó.

1. Dashboard de Stripe → **Settings** → **Billing** → **Customer portal**.
2. Sección **Subscriptions** → *Customers can switch plans*: activado.
3. En **Proration behavior / When to apply the change**, buscá la opción que
   **agenda el cambio al final del período solo cuando el monto baja**
   (`schedule_at_period_end` con la condición `decreasing_item_amount`). Eso
   difiere el downgrade y deja el upgrade inmediato, que es exactamente lo que
   pide el ADR 0003.
4. Guardá y verificá con una cuenta de prueba, en las dos direcciones:
   - bajar de Pro a Starter debe dejar la suscripción en Pro hasta
     `current_period_end`;
   - subir de Starter a Pro debe verse reflejado en el acto (un tenant
     bloqueado por cuota se desbloquea pagando, sin esperar la factura).

Si la UI del Dashboard no expusiera esa condición, se puede fijar por API sobre
la configuración del portal (`subscription_update.schedule_at_period_end`).
**No** dejes el comportamiento por defecto (inmediato con prorrateo): un cliente
que baja de plan con 5 páginas conectadas queda restringido el mismo día.

---

## Paso 10 — Smoke tests finales (validan node:crypto bajo `nodejs_compat`)

En `https://resender.dev`:

- [ ] **Login** con un usuario existente → valida **scrypt**.
- [ ] **Connections**: la página conectada se ve y muestra su webhook URL →
      valida **AES-256-GCM** (descifrado del page token).
- [ ] **Send saliente** con una API key → valida **HMAC**:

  ```sh
  curl -X POST 'https://resender.dev/api/meta/send' \
    -H 'Authorization: Bearer pk_live_...' \
    -H 'Content-Type: application/json' \
    -H 'Idempotency-Key: smoke-test-1' \
    -d '{"pageId":"<meta_page_id>","recipientId":"<psid>","reply":"smoke test"}'
  ```

  Repite el mismo curl: la segunda respuesta debe traer
  `"idempotentReplay": true` y **no** mandar otro mensaje.
- [ ] **Flujo de entrada completo**: mensaje real a la página → aparece en el
      dashboard → llega al webhook configurado → fila `success` en
      `external_webhook_deliveries`.
- [ ] **Billing**: `stripe trigger` del paso 9.6 marcó 200 y la suscripción se
      refleja en `/billing`.

Cuando todo esto pase, la migración está cortada. Los pendientes de escala
(Queues, Worker `apps/gateway` separado, Durable Objects) quedan para una fase
posterior según el handoff.
