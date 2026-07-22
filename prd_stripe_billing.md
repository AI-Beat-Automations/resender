# PRD — Suscripciones con Stripe (Checkout hosteado + Customer Portal)

Decisión de arquitectura: `docs/adr/0002-stripe-checkout-subscriptions.md`. Vocabulario canónico: entradas de billing en `CONTEXT.md`.

## Problem Statement

Resender no cobra: hoy el único gate es la waitlist. Se necesita monetizar con 3 suscripciones mensuales (Starter $15, Pro $25, Business $60 USD) sin manejar datos de tarjeta en nuestros servidores — el pago y la gestión de la suscripción deben ocurrir en páginas hosteadas por Stripe.

## Solution

Dos gates en serie: waitlist (quién entra) → suscripción (quién usa). El usuario aprobado en waitlist sin suscripción activa ve una página de pricing con los 3 planes; al elegir uno se le redirige a **Stripe Checkout**, donde paga el primer mes; al volver, el acceso se abre cuando el webhook de Stripe replica la suscripción (`active`) en Postgres. No hay trial: pagar para usar. Toda gestión posterior (cambiar plan, tarjeta, cancelar) vive en el **Customer Portal**, enlazado desde Settings. El gate lee de la DB en cada request, fail-closed, igual que la waitlist.

Estado con acceso: `active`. Todo lo demás = **bloqueo total** (dashboard, OAuth Meta, `/api/meta/send` 403, y los entrantes de Meta del tenant se descartan sin persistir, respondiendo `200` a Meta).

## User Stories

- Como usuario aprobado en waitlist, veo los 3 planes y al elegir uno pago en una página de Stripe sin que Resender vea mi tarjeta.
- Como suscriptor, desde Settings abro el Customer Portal para cambiar de plan, actualizar tarjeta o cancelar (con acceso hasta fin del período pagado).
- Como operador, el estado de cada suscripción se refleja solo vía webhooks; no hay conciliación manual.

## Implementation Decisions

### Modelo de datos (migración `0005_billing.sql`)

- `users`: agregar `stripe_customer_id text unique` (nullable; se crea el Customer la primera vez que el usuario inicia Checkout).
- Nueva tabla `subscriptions` (una fila por tenant, upsert por webhook):
  - `tenant_id uuid pk references users(id) on delete cascade`
  - `stripe_subscription_id text unique not null`
  - `status text not null` (valores de Stripe: `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`)
  - `price_lookup_key text not null` (plan contratado)
  - `current_period_end timestamptz`
  - `cancel_at_period_end boolean not null default false`
  - `created_at` / `updated_at`

### Identificación de planes

Los 3 Prices en Stripe llevan **lookup keys**: `starter_monthly`, `pro_monthly`, `business_monthly`. El código referencia lookup keys (constantes en `lib/billing/plans.ts`), nunca price IDs hardcodeados — así test y live comparten código y renombrar productos no rompe nada.

### Checkout (server action en `features/billing/actions.ts`)

`startCheckout(lookupKey)`:
1. Requiere sesión + `waitlisted = false` + sin suscripción con acceso (si ya tiene, redirige al Portal).
2. Crea (o reutiliza) el Stripe Customer con el email del usuario y guarda `stripe_customer_id`; `metadata.tenantId = userId` en Customer y Subscription.
3. Crea Checkout Session: `mode: "subscription"`, price por lookup key, `success_url: /billing/success`, `cancel_url: /billing`. Sin trial: el primer cobro ocurre en el propio Checkout.
4. Redirect a `session.url`.

La página de éxito no abre acceso por sí misma: muestra "activando…" y el acceso real lo abre el webhook (evitar confiar en el redirect de vuelta).

### Webhook (`app/api/stripe/webhook/route.ts`)

- Verificación de firma con `stripe.webhooks.constructEvent` y `STRIPE_WEBHOOK_SECRET` (leer el body **raw**). Espejo del patrón del webhook de Meta (`app/api/meta/webhook/route.ts`).
- Eventos manejados: `checkout.session.completed` (vincular customer↔tenant si hiciera falta), `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
- Handler idempotente: upsert de `subscriptions` por `stripe_subscription_id` con el status/price/period del propio evento. `tenant_id` se resuelve por `metadata.tenantId` o por `stripe_customer_id`.
- Responder 200 rápido; sin colas (mismo criterio que el resto del sistema).

### Gate de acceso (`lib/billing/subscription.ts`)

- `hasActiveSubscription(tenantId)`: `select status from subscriptions where tenant_id = $1` y `status = 'active'`. Fail-closed: error o fila ausente = sin acceso.
- Enforcement (mismos puntos que la waitlist, en serie con ella):
  - `app/(product)/layout.tsx`: sin suscripción → redirect a `/billing` (pricing).
  - `app/api/meta/start` y `/callback`: sin suscripción → redirect a `/billing`.
  - `app/api/meta/send`: sin suscripción → 403.
  - Ingestión de entrantes (`lib/inbound/`): si el tenant dueño de la página no tiene acceso, descartar sin persistir ni reenviar, respondiendo 200 a Meta.

### Portal y UI

- `features/billing/actions.ts`: `openPortal()` crea una Portal Session (`return_url: /settings`) y redirige. En Settings: bloque "Subscription" con plan actual, estado, `current_period_end` y botón "Manage subscription".
- `/billing` (dentro del área autenticada, fuera del gate de suscripción, análogo a `/waitlist`): pricing con las 3 cards y CTA a Checkout.
- El Portal se configura en el Dashboard para permitir: cambiar de plan (entre los 3 prices), actualizar método de pago, cancelar al fin de período. Sin pausas.

### Configuración / secretos

- Nuevas env vars (agregar a `turbo.json` `globalEnv` y README): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Publishable key no se necesita (no hay JS de Stripe embebido; Checkout es redirect puro).
- Dependencia nueva: `stripe` (SDK Node) en `apps/web`.

## Testing Decisions

- Vitest colocado en `lib/billing/*.test.ts`: predicado de acceso por cada status, upsert idempotente del webhook (evento repetido y fuera de orden), y resolución de tenant por metadata y por customer id.
- Manual en test mode con Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, tarjetas de prueba (`4242…`), y `stripe trigger customer.subscription.updated`. Simular fallo de cobro en renovación con test clocks del Dashboard.
- Verificar el bloqueo total: cancelar en Portal → al llegar `customer.subscription.deleted`, el dashboard redirige, `/api/meta/send` da 403 y un entrante de Meta no se persiste.

## Out of Scope (esta fase)

- Diferenciación funcional entre planes (el entitlement es binario; el plan solo se persiste).
- Trial o período de prueba (decisión explícita: pagar para usar).
- Facturación anual, otras monedas, impuestos/Stripe Tax, cupones, facturas con datos fiscales.
- Panel de administración de suscripciones (se consulta en el Dashboard de Stripe).
- Emails propios de billing (Stripe envía recibos y avisos de cobro por su cuenta — activar en Settings del Dashboard).

## Further Notes / Riesgos

- **`past_due` bloquea** (bloqueo total estricto). Stripe reintenta el cobro ~1-2 semanas; durante ese lapso el tenant está cortado. Revertir a "gracia durante reintentos" es cambiar el predicado de acceso en un solo lugar — reconsiderar con usuarios reales (registrado como decisión abierta en el ADR).
- Los entrantes descartados durante un bloqueo se pierden para siempre (decisión consciente del ADR). Siempre responder 200 a Meta para no degradar la app.
- Borrado de cuenta: la fila de `subscriptions` cae por cascade, pero hay que **cancelar la suscripción en Stripe** (best-effort, como la baja de páginas en Meta) antes de borrar, para no seguir cobrando a un usuario sin cuenta.
- El redirect de éxito de Checkout puede llegar antes que el webhook: la página de éxito debe tolerar unos segundos sin suscripción visible (polling ligero o "refresh").

---

# Guía de configuración en Stripe (lo que haces tú, manualmente)

Todo lo de esta sección ocurre en el Dashboard de Stripe o en tu terminal, no en el código. Al final hay una tabla con **exactamente qué valores obtienes y dónde va cada uno**.

## Qué obtienes y dónde va cada valor

| Valor | Dónde lo obtienes | Formato | Dónde va |
|---|---|---|---|
| Secret key (test) | Dashboard → Developers → API keys | `sk_test_…` | `apps/web/.env` → `STRIPE_SECRET_KEY` |
| Secret key (live) | Igual, con test mode apagado | `sk_live_…` | Env vars de producción → `STRIPE_SECRET_KEY` |
| Webhook secret (local) | Lo imprime `stripe listen` al arrancar | `whsec_…` | `apps/web/.env` → `STRIPE_WEBHOOK_SECRET` |
| Webhook secret (producción) | Dashboard → Developers → Webhooks → tu endpoint → "Signing secret" | `whsec_…` | Env vars de producción → `STRIPE_WEBHOOK_SECRET` |
| Lookup keys de los 3 prices | Los defines tú al crear cada price (paso 2) | `starter_monthly`, `pro_monthly`, `business_monthly` | Constantes en `lib/billing/plans.ts` (no son secretos, no van en env) |

Notas:
- **No necesitas la publishable key** (`pk_test_…`/`pk_live_…`): no hay JavaScript de Stripe embebido; Checkout y Portal son redirects puros manejados desde el servidor.
- **No hay que copiar price IDs** (`price_…`) al código: el código resuelve los prices por lookup key, por eso los lookup keys deben escribirse idénticos en test y en live.
- Las secret keys se muestran **una sola vez** al crearlas/revelarlas: cópialas en el momento. Nunca al repo — solo `.env` local (gitignoreado) y el gestor de env vars del hosting.
- Ambas variables ya deben estar declaradas en `globalEnv` de `turbo.json` (eso lo hace la implementación, no tú).

## Configuración en test mode (antes de escribir código)

1. **Cuenta**: crea la cuenta en <https://dashboard.stripe.com> (o usa la existente). Verifica que el toggle **Test mode** (esquina superior derecha) esté encendido; todo lo que sigue se hace primero ahí.
2. **Products y Prices** (Product catalog → **+ Add product**), tres veces:
   - Name: `Starter` → Recurring, Monthly, USD, **$15.00**.
   - Name: `Pro` → Recurring, Monthly, USD, **$25.00**.
   - Name: `Business` → Recurring, Monthly, USD, **$60.00**.
   - En cada price, abre las opciones avanzadas del price (More options / Additional options) y pon el **Lookup key**: `starter_monthly`, `pro_monthly`, `business_monthly` respectivamente. Este paso es el que conecta el Dashboard con el código; si un lookup key está mal escrito, el Checkout de ese plan fallará.
3. **Customer Portal** (Settings → Billing → **Customer portal**):
   - Activa **Update payment methods**.
   - Activa **Switch plans** y agrega los 3 products/prices a la lista de planes permitidos.
   - Activa **Cancel subscriptions** con modo **At end of billing period** (no inmediato).
   - Desactiva pausar suscripciones. Guarda.
4. **Emails de cliente** (Settings → Emails): activa **Successful payments** (recibos) y **Failed payments**.
5. **API keys** (Developers → API keys): copia la **Secret key** de test (`sk_test_…`) a `apps/web/.env` como `STRIPE_SECRET_KEY`.
6. **Stripe CLI para el webhook local**:
   ```sh
   brew install stripe/stripe-cli/stripe
   stripe login          # abre el navegador y vincula tu cuenta
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Al arrancar, `stripe listen` imprime `Your webhook signing secret is whsec_…` — cópialo a `apps/web/.env` como `STRIPE_WEBHOOK_SECRET`. Deja ese proceso corriendo mientras desarrollas (es lo que reenvía los eventos de Stripe a tu localhost).
7. **Probar**: tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha futura, cualquier CVC. Para forzar eventos sueltos: `stripe trigger customer.subscription.updated`.

## Paso a producción (cuando el código esté listo)

1. **Activar la cuenta** (Stripe te lo pide al apagar test mode): datos del negocio, identidad y cuenta bancaria para payouts.
2. **Repetir en live mode** los pasos 2-4 (products/prices con los MISMOS lookup keys, Portal, emails). Los objetos de test no se migran solos — Stripe tiene un botón "copy to live mode" en cada product que ayuda, pero verifica los lookup keys a mano.
3. **Webhook endpoint de producción** (Developers → Webhooks → **+ Add endpoint**):
   - URL: `https://resender.dev/api/stripe/webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (solo esos 4; no "todos los eventos").
   - Tras crearlo, revela su **Signing secret** (`whsec_…`) → env var `STRIPE_WEBHOOK_SECRET` de producción.
4. **API key live** (Developers → API keys, test mode apagado): `sk_live_…` → env var `STRIPE_SECRET_KEY` de producción.
5. **Prueba de humo en live** con una tarjeta real: suscribirse, verificar que el acceso se abre, cambiar de plan en el Portal, cancelar y verificar acceso hasta fin de período. Puedes reembolsarte el cobro desde el Dashboard después.
