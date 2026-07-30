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

La opción se llama **Manage downgrades** (Dashboard → **Settings** → **Billing**
→ **Customer portal** → sección *Subscriptions*), y viene en *Actualizar de
inmediato*. Por API es la condición `decreasing_item_amount`, que difiere solo
cuando el monto baja y deja el upgrade inmediato — justo lo que pide el ADR 0003.

**Ya aplicado en test mode** sobre la configuración default
`bpc_1Tvno5K73vMS5LDKT8YHq5Jv`:

```sh
stripe billing_portal configurations update bpc_1Tvno5K73vMS5LDKT8YHq5Jv \
  -d "features[subscription_update][enabled]=true" \
  -d "features[subscription_update][default_allowed_updates][0]=price" \
  -d "features[subscription_update][products][0][product]=prod_Uvf23m48V8GAFY" \
  -d "features[subscription_update][products][0][prices][0]=price_1TvniOK73vMS5LDKeIBIV3PM" \
  -d "features[subscription_update][products][1][product]=prod_Uvf2GJIzDN2Ql7" \
  -d "features[subscription_update][products][1][prices][0]=price_1TvnidK73vMS5LDKEHpNsZwh" \
  -d "features[subscription_update][schedule_at_period_end][conditions][0][type]=decreasing_item_amount"
```

Falta repetirlo en **live** con los ids de live (ver paso 9.2).

### Restricción de Stripe que condiciona el catálogo

La doc del portal dice que solo se puede diferir el downgrade *"between prices
that have the same product"*. Pero el catálogo del portal **rechaza** dos precios
del mismo producto con el mismo intervalo:

> For each product, its price must have unique billing intervals.

Starter y Pro son los dos mensuales, así que **no pueden compartir producto**: la
única forma de tenerlos en el catálogo es como productos separados, que es como
están hoy (`prod_Uvf23m48V8GAFY` y `prod_Uvf2GJIzDN2Ql7`). La API acepta la
condición igual; lo que queda por confirmar empíricamente es si el diferimiento
se aplica entre productos distintos o si la restricción de la doc lo invalida.

### Verificación obligatoria (no es opcional)

De esto dependen las historias 13 y 14, que **no tienen código detrás**:

1. Abrí una sesión de portal para un customer con suscripción Pro:
   `stripe billing_portal sessions create --customer=<cus_...> --return-url=https://resender.dev/settings`
2. Bajá de Pro a Starter en la UI.
3. Comprobá el resultado:
   ```sh
   stripe subscription_schedules list --limit 5          # ¿se creó un schedule?
   stripe subscriptions retrieve <sub_...> | grep -E '"lookup_key"|"schedule"'
   ```
   - **Diferido (lo que queremos)**: aparece un `subscription_schedule` y la
     suscripción **sigue en `pro_monthly`** hasta `current_period_end`.
   - **Inmediato (rompe la regla)**: la suscripción ya figura en
     `starter_monthly`. En ese caso el downgrade diferido no se puede lograr con
     el portal y hay que decidir otra cosa: manejar el cambio de plan con UI
     propia y `subscription_schedules`, o aceptar el downgrade inmediato y
     documentarlo (un cliente con 5 páginas quedaría restringido el mismo día).
4. Probá también el upgrade Starter → Pro: debe verse reflejado en el acto.

---

## Paso 9.2 — Catálogo de precios en live (bloqueante para cobrar)

En **live mode no existe ningún precio de Resender**: el único precio live es un
`one_time` de otro producto (`prod_Sn4DbFa5sExTNa`). `startCheckout` busca el
price por `lookup_key`, así que hoy en producción tiraría
`No Stripe price found for lookup key starter_monthly` y nadie podría suscribirse.

```sh
stripe products create --live --name="Resender Starter"
stripe prices create --live --product=<prod_starter> --currency=usd \
  --unit-amount=1500 -d "recurring[interval]=month" -d "lookup_key=starter_monthly"

stripe products create --live --name="Resender Pro"
stripe prices create --live --product=<prod_pro> --currency=usd \
  --unit-amount=2500 -d "recurring[interval]=month" -d "lookup_key=pro_monthly"
```

Después repetí sobre la config default de live el `billing_portal configurations
update` del paso 9.1, con los ids de live.

**No crees `business_monthly`**: el plan fue eliminado (ADR 0003). En test sigue
activo (`price_1Tvnj6K73vMS5LDKjcrI8Oiw`); conviene archivarlo por higiene, aunque
el código ya no lo ofrece y nadie puede suscribirse:

```sh
stripe prices update price_1Tvnj6K73vMS5LDKjcrI8Oiw -d "active=false"
```

---

## Paso 10 — Smoke tests finales (validan node:crypto bajo `nodejs_compat`)

En `https://resender.dev`:

- [ ] **Login** con un usuario existente → valida **scrypt**.
- [ ] **Connections**: la página conectada se ve y muestra su webhook URL →
      valida **AES-256-GCM** (descifrado del page token).
- [ ] **Send saliente** con una API key → valida **HMAC**:

  ```sh
  curl -i -X POST 'https://api.resender.dev/v1/messages' \
    -H 'Authorization: Bearer pk_live_...' \
    -H 'Content-Type: application/json' \
    -H 'Idempotency-Key: smoke-test-1' \
    -d '{"pageId":"<internal_page_uuid>","recipientId":"<psid>","type":"text","text":"smoke test"}'
  ```

  Repite el mismo curl: la segunda respuesta debe traer el header
  `Idempotent-Replayed: true` y **no** mandar otro mensaje.
- [ ] **Flujo de entrada completo**: mensaje real a la página → aparece en el
      dashboard → llega al webhook configurado → fila `success` en
      `external_webhook_deliveries`.
- [ ] **Billing**: `stripe trigger` del paso 9.6 marcó 200 y la suscripción se
      refleja en `/billing`.

Cuando todo esto pase, la migración está cortada. Los pendientes de escala
(Queues, Worker `apps/gateway` separado, Durable Objects) quedan para una fase
posterior según el handoff.
