# Código con vigencia

## Contexto

Hoy Stripe ya permite introducir un cupón de descuento al contratar una suscripción.

El problema es que ese cupón se aplica **durante toda la vida de la suscripción**: el descuento no caduca y se reitera en cada renovación.

## Objetivo

Crear códigos promocionales **con vigencia limitada**: el beneficio aplica solo durante un período inicial y, al terminar, el cobro vuelve al precio normal del plan.

A partir de ahora, **todos los códigos nuevos** serán de este tipo. Ya no se crearán cupones de descuento permanente.

## Ejemplo

El código `LORIAGOSTO2026`:

1. El **primer mes** es gratuito.
2. A partir del **segundo mes**, el cobro es el precio normal de la suscripción.

El código habilita una promoción temporal, no un descuento indefinido.
