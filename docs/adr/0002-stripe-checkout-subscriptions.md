---
status: accepted
---

# Suscripciones con Stripe Checkout hosteado + Customer Portal (sin tocar tarjetas)

Resender necesita cobrar suscripciones (3 planes mensuales: Starter $15, Pro $25, Business $60 USD) sin manejar datos de tarjeta en sus servidores. Se decidió usar **Stripe Checkout** (página de pago hosteada por Stripe, vía redirect) para la compra inicial y el **Customer Portal** de Stripe para todo el ciclo de vida posterior (cambio de plan, actualización de tarjeta, cancelación). El servidor de Resender nunca ve un PAN: solo crea sesiones de Checkout/Portal por API y consume webhooks firmados. Esto deja a Resender en el alcance PCI mínimo (SAQ A) y elimina la necesidad de construir UI de billing propia.

## Considered Options

- **Checkout + Customer Portal hosteados** — elegido. Cero manejo de tarjetas, cero UI de billing que mantener, upgrades/downgrades y dunning resueltos por Stripe. A cambio, la experiencia de pago vive en dominio de Stripe (redirect) y la personalización es limitada.
- **Stripe Elements / Payment Element embebido** — rechazado. Más control visual pero el formulario de tarjeta corre en la página de Resender (más superficie de riesgo, SAQ A-EP) y habría que construir la UI de gestión de suscripción a mano.
- **Solo Checkout, sin Portal (gestión propia vía API)** — rechazado. Obliga a construir y mantener flujos de cambio de plan/cancelación que el Portal da gratis.

## Decisiones de dominio (fijadas en la entrevista)

- **Dos gates en serie**: la waitlist decide quién puede *entrar*; la suscripción decide quién puede *usar*. Un usuario aprobado en waitlist sin suscripción activa aterriza en la página de pricing, no en el producto.
- **Planes**: Starter $15 / Pro $25 / Business $60, **solo mensual**, solo USD. La diferenciación funcional entre planes **aún no está definida**: por ahora el entitlement es binario (suscripción activa sí/no) y el plan se persiste solo para diferenciar en el futuro.
- **Sin trial**: pagar para usar. El primer cobro ocurre en el propio Checkout; no hay período de prueba ni lógica de trial en ninguna capa.
- **Bloqueo total sin suscripción activa**: acceso solo con status `active`. Cualquier otro estado (nunca pagó, `past_due`, `canceled`, `unpaid`) bloquea dashboard, OAuth de Meta y `POST /api/meta/send` (403), y los webhooks entrantes de Meta de ese tenant se **descartan sin persistir** (se responde `200` a Meta igualmente, para no degradar la app ante Meta). Los mensajes de ese período se pierden; es una decisión consciente.
- **Cancelación al fin del período**: el Portal usa `cancel_at_period_end`; quien pagó el mes lo usa completo.
- **Fuente de verdad local**: el estado de la suscripción se replica en Postgres vía webhooks de Stripe y el gate lo lee de DB en cada request (mismo patrón fail-closed que la waitlist, ver `lib/auth/waitlist.ts`). Nunca se consulta la API de Stripe en el hot path.

## Consequences

- Nueva dependencia operativa: hay que configurar Products/Prices, Customer Portal y webhook endpoint en el Dashboard de Stripe (test y live), y correr `stripe listen` en desarrollo.
- Nuevo endpoint público `app/api/stripe/webhook` con verificación de firma (`STRIPE_WEBHOOK_SECRET`), espejo del patrón HMAC ya usado para el webhook de Meta.
- Migración `0005`: `users.stripe_customer_id` + tabla `subscriptions` (una fila por tenant).
- Bloquear durante `past_due` significa cortar servicio mientras Stripe todavía reintenta el cobro (~1-2 semanas de smart retries). **Decisión abierta y barata de revertir**: dar gracia durante `past_due` es cambiar una línea en el predicado de acceso; se recomienda reconsiderarlo cuando haya usuarios reales con renovaciones fallidas.
- La página de pricing y el estado de billing en Settings son la única UI nueva; todo lo demás es de Stripe.
