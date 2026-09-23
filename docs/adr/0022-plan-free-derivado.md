---
status: accepted
---

# Plan Free derivado: se quita el muro de pago

Fecha: 2026-09-23. Reemplaza el gate de suscripción y la regla "sin trial" de la
[ADR 0002](0002-stripe-checkout-subscriptions.md), y amplía los límites y el período de cuota de
la [ADR 0003](0003-plan-entitlements-usage-quota.md).

## Contexto

Hasta ahora usar Resender exigía pagar: sin una suscripción `active` el layout de `(product)`
rebotaba a `/billing`, el envío respondía `403 no active subscription` y los entrantes se
descartaban sin persistir. Queremos que cualquiera que se registre pueda usar el producto de
inmediato, con un plan gratis limitado.

## Plan

| Plan | Precio | Mensajes / mes | Conexiones | Soporte |
|---|---|---|---|---|
| Free | $0 | 2.000 | 1 | Email + Discord |

El soporte es solo copy del pricing: no hay nada en el producto que distinga el soporte por plan.

## Considered Options

- **Fila en `subscriptions` con `price_lookup_key = 'free'`, creada al registrarse**: rechazada.
  La tabla es un espejo de Stripe (`stripe_subscription_id`, orden de eventos del webhook); una
  suscripción fantasma rompe esa invariante, necesita backfill para las cuentas existentes y
  otra escritura cuando una suscripción de pago se cae.
- **Mes contado desde la fecha de registro**: rechazada. Obliga a guardar un ancla por tenant y a
  resolver los días 29 a 31. El mes calendario UTC se calcula con `now` y encaja en la clave
  `(tenant_id, period_start)` de `usage_counters` sin cron.
- **Contar solo los mensajes salientes en el Free**: rechazada. La definición de [Mensaje
  contabilizado] es la misma en todos los planes.
- **Que `past_due` o `unpaid` sigan bloqueando del todo para presionar el pago**: rechazada.
  Stripe ya reintenta el cobro; "sin pago activo = Free" es una sola regla.

## Decisión

- **El plan Free es derivado.** Cualquier tenant sin suscripción de pago `active` (sin fila,
  `canceled`, `past_due`, `unpaid`, `incomplete`...) está en el Free. `FREE_PLAN` vive en
  `lib/billing/plans.ts` aparte de `PLANS`, que sigue siendo el catálogo que se compra por
  Checkout. `resolveTenantPlanLimits` y `evaluateEntitlement` (`lib/billing/entitlements.ts`)
  deciden el plan efectivo a partir del status.
- **Período del Free: mes calendario UTC.** `period_start` es el día 1 a las 00:00 UTC. Los planes
  de pago siguen contando por el período de Stripe.
- **Se quita el gate de suscripción** del layout de `(product)`, del connect gate de los dueños,
  de las rutas de envío (Messenger, Instagram, WhatsApp y respuestas a comentarios) y de la
  ingesta de entrantes. Lo que limita a un tenant sin pago es el entitlement: cuota, exceso de
  conexiones y [Cuenta restringida], igual que en los planes de pago.
- **Gate de correo confirmado.** Usar el Free exige el correo confirmado. Una cuenta sin
  confirmar y sin suscripción `active` aterriza en `/pending`, que le pide confirmar y la manda
  al producto cuando lo hace. Aplica en el layout de `(product)` y en el connect gate
  (`email_unverified`). Una suscripción `active` lo salta, porque esas cuentas se crearon cuando
  no se pedía confirmación. La API y los webhooks no miran el correo: sin conexiones no hay
  tráfico, y los gobiernan los límites. Vive en `lib/billing/free-plan-gate.ts`.
- **Lookup key desconocido en una suscripción `active`** sigue siendo fail-closed
  (`plan_unavailable`). No cae al Free: dejaría con 1 conexión a un cliente que paga.
- **Clientes.** Solo un padre con Pro o Business `active` administra Clientes. Si el padre cae
  al Free, sus clientes ven `ClientRestrictedScreen`, igual que antes cuando el padre no pagaba.
  Los datos se conservan.
- **`/billing` pasa a ser la página de upgrade.** Ya nadie rebota ahí; tiene un enlace de vuelta
  a la app. Ajustes → Suscripción muestra el plan Free, el consumo del mes y "Mejorar plan", y el
  portal de Stripe solo si hubo una suscripción.
- **Pricing público**: una cuarta tarjeta, Free, con el CTA a `/register`.

## Consequences

- Una suscripción que se cancela o deja de cobrarse ya no apaga la cuenta: cae al Free. Si tenía
  más de 1 conexión activa queda como [Cuenta restringida] (`page_limit_exceeded`) hasta que
  desconecte o vuelva a pagar. No desconectamos nada nosotros.
- **El contador se reinicia al cruzar entre Free y pago**, en los dos sentidos, porque la clave
  del contador cambia (el día 1 contra `current_period_start`). Quien usó 1.900 de 2.000 y sube de
  plan arranca su período pago en 0; quien cancela a mitad de mes retoma el contador del mes
  calendario, que suele estar en 0 salvo que ese mismo mes ya hubiera usado el Free. Se acepta:
  no hay lógica de arrastre. Entre planes de pago sigue valiendo [Cambio de plan].
- Los entrantes de un tenant sin pago ya no se descartan: se persisten y cuentan. Al agotar la
  cuota se guardan y no se reenvían, como en cualquier plan.
- El motivo de log `no_active_subscription` queda solo para el cliente cuyo padre no tiene plan
  de pago. Se agrega `email_unverified` a la sección `connections` del catálogo.
- No hay aviso de cuota por correo: la barra del dashboard al 80% y al 100% es la misma de
  siempre. El correo queda como trabajo aparte.
- Registrarse no tiene tope de cuentas por persona. Si aparece abuso del Free se revisa aparte.
