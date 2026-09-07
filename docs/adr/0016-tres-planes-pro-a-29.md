---
status: accepted
---

# Tres planes: Pro sube a $29 y vuelve Business a $60

Fecha: 2026-09-07. Enmienda la [ADR 0003](0003-plan-entitlements-usage-quota.md), que había
dejado dos planes y eliminado `business_monthly`.

## Planes

| Plan | Precio | Mensajes / período | Conexiones |
|---|---|---|---|
| `starter_monthly` | $15 | 50.000 | 2 |
| `pro_monthly` | $29 | 100.000 | 5 |
| `business_monthly` | $60 | 250.000 | 12 |

Starter no cambia. Pro sube de $25 a $29 con los mismos límites. Business vuelve con el mismo
precio que tenía en la ADR 0002, ahora con 12 conexiones y 250.000 mensajes.

## Considered Options

- **Lookup key nueva para Business** (`business_12_monthly` o similar) — rechazada. El price
  archivado de $60 sigue existiendo en Stripe con `business_monthly`, en test y en live, y no tuvo
  nunca suscripciones. Reactivarlo es un toggle; crear otro deja dos prices de $60 con historia
  distinta y una key que no dice nada más que la anterior.
- **Editar el price de Pro** — imposible. Los prices de Stripe son inmutables: se crea uno nuevo
  de $29 con `transfer_lookup_key: true` para que `pro_monthly` apunte al nuevo, y el de $25 se
  archiva. El código no cambia porque resuelve por lookup key, nunca por price ID.
- **Migrar automáticamente a $29 a quien ya paga $25** — fuera de alcance. Stripe no mueve
  suscripciones existentes al archivar un price; siguen en $25 hasta que alguien las cambie. Esa
  migración, si se hace, es una operación aparte en el Dashboard o por API y con aviso previo.

## Decisión

- `PLAN_LOOKUP_KEYS` y `PLANS` en `lib/billing/plans.ts` pasan a tres entradas.
- El copy público (landing, `/pricing`, FAQ, `llms.txt`) y `/billing` muestran tres tarjetas.
  Pro sigue siendo el plan recomendado.
- En Stripe, por entorno (test y live): price nuevo de $29 en el producto Pro con transferencia
  de `pro_monthly`, archivar el de $25, reactivar el producto Business y su price de $60.
- También por entorno: la configuración por defecto del Customer Portal lista los prices
  elegibles de forma explícita y no sigue la lookup key. Hay que reemplazar el price de $25 por
  el de $29 y sumar el de Business, o el portal sigue mostrando los precios viejos.

## Consequences

- Un tenant con `price_lookup_key = business_monthly` deja de caer en `plan_unavailable` y
  resuelve límites. Los tests que usaban esa key como «desconocida» pasan a `enterprise_monthly`.
- Las suscripciones vigentes a $25 conservan su precio; el mapa en código les aplica los mismos
  límites porque comparten lookup key.
- Las grillas de tarjetas pasan a tres columnas en `lg`.
