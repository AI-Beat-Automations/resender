# Runbook: pasar Stripe de test a live

Estado al 2026-07-31, verificado contra la cuenta `acct_1N4U64K73vMS5LDK`
(Resender, MX) con consultas de solo lectura.

La cuenta **ya está habilitada para cobrar** (`charges_enabled`,
`payouts_enabled` y `details_submitted` en `true`). Lo que falta es que el modo
live tenga los objetos que el código da por sentados: en live no existe ningún
price con los lookup keys de `lib/billing/plans.ts`, no hay webhook endpoint y
no hay configuración de Customer Portal.

## Quién atiende el webhook

**Decisión tomada: se va a live sobre la fase 1**, con todo concentrado en el
Worker `web` (Next). El webhook lo procesa `web` en
`https://resender.dev/api/stripe/webhook` y las keys de Stripe viven en los
secrets de ese Worker. Este runbook describe ese camino y ninguno más.

La fase 2 mueve la ingesta al Worker `api`
(`https://api.resender.dev/webhooks/stripe`) y los secretos de Stripe con ella.
Cuando ese cutover se ejecute, lo que cambia respecto a este documento es
solamente:

- el destino del webhook endpoint en el Dashboard;
- en qué Worker viven `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`;
- `STRIPE_WEBHOOK_URL=https://api.resender.dev/webhooks/stripe` al correr el
  preflight.

Los products, prices, el Portal y los datos de la base no se vuelven a tocar:
la fase 2 mueve código, no la configuración de Stripe. Lo que sí no debe pasar
es hacer ambos cortes en la misma ventana — una falla ahí es un problema de dos
variables en vez de una.

## Verificación

```bash
cd apps/web
npm run stripe:preflight            # lee .env      → modo test
npm run stripe:preflight -- --live  # lee .env.live → modo live
```

`.env.live` no está versionado (git ignora `.env*`) y contiene una sola línea:

```
STRIPE_SECRET_KEY=rk_live_...
```

Los dos archivos van separados a propósito: `.env` es el de desarrollo y lleva
keys de test. Comentar y descomentar bloques dentro de un mismo `.env` para
cambiar de modo es cómodo hasta el día en que se olvida cuál quedó activo y se
corre contra live creyendo que es test. El script aborta si el archivo no tiene
una key del modo que su nombre promete.

Solo lee. Contrasta contra Stripe los lookup keys y precios declarados en
`lib/billing/plans.ts`, el endpoint de webhook (existencia, eventos y versión de
API), la configuración default del Portal y el estado de la cuenta. Sale con
código 1 si algo bloquea el cobro.

Para apuntar al destino de la fase 2:
`STRIPE_WEBHOOK_URL=https://api.resender.dev/webhooks/stripe`.

La key restringida de la app no tiene permiso de lectura sobre webhooks ni sobre
la cuenta —a propósito— y el script marca esas secciones como no verificadas en
vez de fallar. Para cubrirlas, repetir con una key que tenga esos scopes.

## La trampa de la versión de API

**Cada webhook endpoint queda pinneado a la versión de API vigente cuando se
creó**, y Stripe ha movido de lugar dos campos que este código necesita. Ninguna
de las dos mudanzas produce un error: el evento se procesa, responde 200 y
guarda el dato equivocado. Por eso las dos están normalizadas en
`lib/billing/subscription.ts` y cubiertas por tests.

| Dato                   | Antes                        | Desde                               | Si se lee mal                                                                  |
| ---------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| Período de facturación | raíz de la suscripción       | `2025-03-31.basil`, en cada item    | período NULL: la cuota de mensajes (ADR 0003) se queda sin ventana             |
| Baja programada        | `cancel_at_period_end: true` | `2026-07-29.dahlia`, en `cancel_at` | la cancelación pasa desapercibida y el panel dice "renueva" a quien ya canceló |

`resolveSubscriptionPeriod` y `resolveCancelAtPeriodEnd` aceptan ambas formas,
así que la ingesta es correcta con cualquier pinneo. Aun así, el endpoint de
live conviene crearlo con una versión reciente: el fallback es una red, no el
camino previsto.

La segunda mudanza se descubrió cancelando desde el Portal durante la
verificación con tarjeta real (evento `evt_1TzST5K73vMS5LDKRINvV7kd`). Vale la
pena repetir esa prueba en cada cambio de versión de API del endpoint.

## Secuencia de cutover

### 1. Objetos en Stripe live

Products y prices con los lookup keys exactos que espera el código
(`starter_monthly` $15 USD/mes, `pro_monthly` $25 USD/mes):

```bash
STARTER=$(stripe products create --live -d "name=Starter" -d "type=service" \
  | grep '"id"' | head -1 | cut -d'"' -f4)
stripe prices create --live \
  -d "product=$STARTER" -d "currency=usd" -d "unit_amount=1500" \
  -d "recurring[interval]=month" -d "lookup_key=starter_monthly"

PRO=$(stripe products create --live -d "name=Pro" -d "type=service" \
  | grep '"id"' | head -1 | cut -d'"' -f4)
stripe prices create --live \
  -d "product=$PRO" -d "currency=usd" -d "unit_amount=2500" \
  -d "recurring[interval]=month" -d "lookup_key=pro_monthly"
```

`business_monthly` no se crea: quedó fuera por el ADR 0003.

### 2. Customer Portal en live

El código crea sesiones de Portal sin pasar `configuration`, así que Stripe usa
la **default** de la cuenta. En live no existe ninguna, y sin ella cancelar o
cambiar de plan devuelve error. Configurarlo en el Dashboard (Settings →
Billing → Customer portal, en modo live) replicando lo que ya está en test:

| Opción                | Valor                                                          |
| --------------------- | -------------------------------------------------------------- |
| Cancelación           | habilitada, **al final del período** (ADR 0002), sin prorrateo |
| Motivo de cancelación | habilitado                                                     |
| Cambio de plan        | habilitado, solo `price`, prorrateo `always_invoice`           |
| Método de pago        | actualizable                                                   |
| Historial de facturas | visible                                                        |
| Pausar suscripción    | deshabilitado                                                  |

Guardar desde el Dashboard es lo que crea la configuración default; una creada
por API no queda como default automáticamente.

### 3. Webhook endpoint en live

Dashboard → Developers → Webhooks (modo live), destino
`https://resender.dev/api/stripe/webhook`, versión de API `2026-06-24.dahlia`,
y **solo** estos cuatro eventos:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copiar el signing secret (`whsec_...`); se usa en el paso 4.

### 4. Restricted key y secrets

Crear en el Dashboard (modo live) una restricted key con permisos de escritura
en Customers, Checkout Sessions, Subscriptions, Billing Portal sessions y
Refunds, y de lectura en Prices. Después:

```bash
cd apps/web
npx wrangler secret put STRIPE_SECRET_KEY      # rk_live_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_... del paso 3
```

`staging` se queda en modo test: nunca recibe las keys live.

### 5. Limpiar los datos de test en la base de producción

**Ejecutado el 2026-07-31.** Queda aquí como registro; el SQL vivía en un
archivo que se borró después de aplicarlo, porque volver a correrlo hoy le
quitaría el acceso a los clientes que ya pagan.

Los identificadores de Stripe están namespaceados por modo: un `cus_...` creado
en test no existe para la key live, así que el checkout de quien lo tuviera
guardado moría con "No such customer". Y una fila de `subscriptions` en
`active` heredada de test le daba acceso permanente a alguien que en live no
paga nada — el gate lee esa tabla, y en live ya nunca iba a llegar un webhook
que cerrara esa suscripción.

```sql
begin;

-- Revisar esta salida antes de seguir: si aparece una suscripción que no sea
-- de pruebas, `rollback` en vez de `commit`.
select count(*) filter (where stripe_customer_id is not null) from users;
select tenant_id, stripe_subscription_id, status, price_lookup_key from subscriptions;

delete from subscriptions;
update users set stripe_customer_id = null where stripe_customer_id is not null;

commit;
```

Tras el borrado el gate falla cerrado —sin fila no hay acceso— y el primer
checkout en live crea un Customer nuevo del modo correcto.

### 6. Deploy y verificación

```bash
cd apps/web && npm run deploy
npm run stripe:preflight -- --live   # debe salir en verde
```

Después, con tarjeta real:

1. Suscribirse a Starter ($15) y confirmar la llegada a `/billing/success`.
2. En la base: la fila de `subscriptions` queda en `active` y con
   `current_period_end` **no nulo** (si es NULL, la versión de API del endpoint
   quedó mal).
3. Entrar al dashboard y comprobar que el gate abre.
4. Abrir el Portal, cambiar a Pro, cancelar, y verificar `cancel_at_period_end`.
5. Reembolsar desde el Dashboard y cancelar la suscripción de prueba.

### 7. Cierre

- Deshabilitar el endpoint de test que apunta a producción.
- Confirmar en el Dashboard que las primeras facturas se emitieron y que los
  emails a clientes salieron.

## Rollback

Volver a poner las keys de test con `wrangler secret put` y redeployar. Nada del
esquema cambia, así que el rollback es solo de credenciales. Las suscripciones
live que ya se hayan creado hay que cancelarlas y reembolsarlas a mano desde el
Dashboard: el espejo local se queda con filas que la key de test no puede
resolver.

## Pendientes que no bloquean el go-live

- **Moneda**: la cuenta liquida en MXN y los precios son USD. Stripe convierte
  en el payout; confirmar el tipo de cambio y la comisión antes de proyectar
  ingresos.
- **Impuestos**: no hay `automatic_tax` ni recolección de RFC. Decisión
  pendiente con contador si se factura IVA en México.
- **Branding** de Checkout y Portal: se configura por modo, no se hereda de
  test.
- **Radar**: revisar las reglas por defecto antes del primer cobro real.
- **Higiene**: `apps/web/.env` guarda `STRIPE_SECRET_KEY` y
  `STRIPE_WEBHOOK_SECRET` de test para desarrollo local; tras el cutover a la
  fase 2, esos secrets salen del Worker `web` y pasan a `api`.
